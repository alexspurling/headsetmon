const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;
const Pango = imports.gi.Pango;

const Desklet = imports.ui.desklet;

const UUID = "headsetmon@bytepath";

const HEADSET_PROFILE = "headset-head-unit-msbc";
const HIGH_QUALITY_PROFILE = "a2dp-sink";

class DeskClock extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this._timeoutId = 0;
        this._entityInfo = {};
        this._sinks = new Map();
        this._defaultSinkName = null;
        this._sinkIndexToName = {};
        this._cards = {};
        this._knownBtCards = {};
        this._bondedDevices = [];
        this._updateTimerId = null;
        this._disconnectedBtMac = null;
        this._connectingMac = null;
        this._spinnerAngle = 0;
        this._spinnerTimerId = 0;
        this._spinnerIcon = null;

        // ─── Container ─────────────────────────────────────────
        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "dialog"
        });

        // ─── Device header row ──────────────────────────────────
        this._deviceIconBox = new St.Widget({
            style_class: "device-icon",
            layout_manager: new Clutter.BinLayout()
        });
        this._deviceIcon = new St.Icon({ icon_name: "audio-speakers", icon_size: 22 });
        this._deviceIconBox.add_actor(this._deviceIcon);
        this._statusBadge = new St.Widget({ style_class: "status-badge" });
        this._deviceIconBox.add_actor(this._statusBadge);
        this._statusBadge.hide();

        this._deviceName = new St.Label({ style_class: "device-name" });
        this._deviceName.clutter_text.set_line_wrap(true);
        // By default, labels have ellipsis behaviour which means the text truncates and adds "..." even if line wrap is turned on
        // we can disable it by setting the ellipsize mode to NONE
        this._deviceName.clutter_text.ellipsize = Pango.EllipsizeMode.NONE;

        this._deviceSubtitle = new St.Label({ style_class: "device-subtitle" });
        this._deviceSubtitle.hide();

        let deviceInfo = new St.BoxLayout({
            vertical: true,
            style_class: "device-info",
            x_expand: true
        });
        deviceInfo.add_actor(this._deviceName);
        deviceInfo.add_actor(this._deviceSubtitle);

        let deviceRow = new St.BoxLayout({
            style_class: "device-row"
        });
        deviceRow.add_actor(this._deviceIconBox);
        deviceRow.add_actor(deviceInfo);
        this._container.add_actor(deviceRow);

        this._container.add_actor(new St.Widget({ style_class: "divider" }));

        // ─── Section label: Output device ───────────────────────
        this._outputSectionLabel = new St.Label({
            text: "OUTPUT DEVICE",
            style_class: "section-label"
        });
        this._container.add_actor(this._outputSectionLabel);

        // ─── Output list ────────────────────────────────────────
        this._outputList = new St.BoxLayout({
            vertical: true,
            style_class: "output-list"
        });

        this._btDynamicContainer = new St.BoxLayout({ vertical: true });
        this._outputList.add_actor(this._btDynamicContainer);
        this._container.add_actor(this._outputList);

        // ─── Available devices section ──────────────────────────
        this._availableSlot = new St.BoxLayout({ vertical: true });
        this._availableSectionLabel = new St.Label({
            text: "OTHER DEVICES",
            style_class: "section-label"
        });
        this._availableSlot.add_actor(this._availableSectionLabel);
        this._availableSectionLabel.hide();
        this._availableContainer = new St.BoxLayout({ vertical: true });
        this._availableSlot.add_actor(this._availableContainer);
        this._container.add_actor(this._availableSlot);

        // Load stylesheet
        this._reloadStylesheet();

        this.setContent(this._container);
        this.setHeader(_("Headsetmon"));
    }

    _reloadStylesheet() {
        let dir = GLib.build_filenamev([
            GLib.get_user_data_dir(), 'cinnamon', 'desklets', UUID
        ]);
        let cssPath = GLib.build_filenamev([dir, 'stylesheet.css']);
        let theme = new St.Theme();
        theme.load_stylesheet(cssPath);
        this._container.set_theme(theme);
    }

    on_desklet_added_to_desktop(userEnabled) {
        try {
            log("headsetmon: Loading desklet");

            this._pulseAudioProcess = new Gio.Subprocess({
                // argv: ["/home/alex/dev/cpp/paeventmon/cmake-build-debug/paeventmon"],
                argv: ["/home/alex/dev/cpp/paeventmonrust/target/release/paeventmonrust"],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            this._pulseAudioProcess.init(null);
            let stdout = this._pulseAudioProcess.get_stdout_pipe();
            this._pulseAudioStream = new Gio.DataInputStream({
                base_stream: stdout
            });
            this._readPulseAudioEvent();

            log("headsetmon: Running initial fullUpdate");
            this._readBondedDevices();
            this._doFullUpdate();
        } catch (e) {
            log("Error calling pulseAudio: " + e);
        }
    }

    _readPulseAudioEvent() {
        this._pulseAudioStream.read_line_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (stream, result) => {
                try {
                    let [line] = stream.read_line_finish_utf8(result);
                    if (line === null) return;

                    let evt;
                    try {
                        evt = JSON.parse(line);
                    } catch (_) {
                        this._readPulseAudioEvent();
                        return;
                    }

                    log("headsetmon: PA event — " + line);

                    let on = evt.on || evt.facility;
                    let event = evt.event;

                    // Rust format nests entity fields under "data" for new events.
                    // Merge them into evt so the dispatch below works uniformly.
                    if (evt.data) {
                        let data = evt.data;
                        delete evt.data;
                        for (let k in data) {
                            evt[k] = data[k];
                        }
                        // Normalise field names from Rust format to what the
                        // dispatch logic expects.
                        if (evt.properties !== undefined && evt.proplist === undefined) {
                            evt.proplist = evt.properties;
                        }
                        if (typeof evt.active_profile === "string") {
                            evt.active_profile = {
                                name: evt.active_profile,
                                description: evt.active_profile
                            };
                        }
                        if (evt.profiles !== undefined && evt.profiles2 === undefined) {
                            evt.profiles2 = [];
                            for (let name in evt.profiles) {
                                let p = evt.profiles[name];
                                p.name = name;
                                evt.profiles2.push(p);
                            }
                        }
                    }

                    if (event === "new" || event === "change") {
                        if (on === "sink" && evt.name && evt.card && evt.description) {
                            this._sinks.set(evt.index, {
                                name: evt.name,
                                card: evt.card,
                                description: evt.description
                            });
                            this._fullUpdate();
                        } else if (on === "sink" && event === "change" && evt.prop === "description") {
                            if (this._sinks.has(evt.index)) {
                                this._sinks.get(evt.index).description = evt.new;
                                this._fullUpdate();
                            }
                        } else if (on === "server" && evt.default_sink_name) {
                            this._defaultSinkName = evt.default_sink_name;
                            console.log("Got default sink name", evt);
                            this._fullUpdate();
                        } else if (on === "server" && event === "change" && evt.prop === "default_sink_name") {
                            this._defaultSinkName = evt.new;
                            console.log("Got new default sink name", evt);
                            this._fullUpdate();
                        } else if (on === "card" && event === "new") {
                            log("headsetmon: card new idx=" + evt.index + " name=" + evt.name + " bus=" + (evt.proplist ? evt.proplist["device.bus"] : "?"));
                            this._cards[evt.index] = {
                                name: evt.name,
                                properties: evt.proplist,
                                active_profile: evt.active_profile,
                                profiles: evt.profiles2
                            };
                            if (evt.proplist && evt.proplist["device.bus"] === "bluetooth") {
                                this._knownBtCards[evt.index] = {
                                    name: evt.name,
                                    description: evt.proplist["device.description"] || evt.name,
                                    mac: evt.proplist["device.string"]
                                };
                                this._readBondedDevices();
                            }
                            this._fullUpdate();
                        } else if (on === "card" && event === "change" &&
                           (evt.prop === "active_profile.name" || evt.prop === "active_profile")) {
                            log("headsetmon: card change active_profile.name -> " + evt.new + " idx=" + evt.index);
                            if (this._cards[evt.index]) {
                                this._cards[evt.index].active_profile.name = evt.new;
                            }
                            this._fullUpdate();
                        } else if (on === "card" && event === "change" && evt.prop === "active_profile.description") {
                            log("headsetmon: card change active_profile.description -> " + evt.new + " idx=" + evt.index);
                            if (this._cards[evt.index]) {
                                this._cards[evt.index].active_profile.description = evt.new;
                            }
                            this._fullUpdate();
                        }

                        if (on === "sink" && evt.name) {
                            this._sinkIndexToName[evt.index] = evt.name;
                        }
                    } else if (event === "remove" && on === "sink") {
                        console.log("headsetmon: Removing sink ", evt);
                        let name = this._sinkIndexToName[evt.index];
                        if (name) {
                            console.log("Removing sink from state", this._sinks.size);
                            this._sinks.delete(evt.index);
                            delete this._sinkIndexToName[evt.index];
                            console.log("Removed sink from state", this._sinks.size);
                            this._fullUpdate();
                        }
                    } else if (event === "remove" && on === "card") {
                        if (this._cards[evt.index]) {
                            let wasBluetooth = this._isBluetoothCard(this._cards[evt.index]);
                            delete this._knownBtCards[evt.index];
                            delete this._cards[evt.index];
                            if (wasBluetooth) this._readBondedDevices();
                            this._fullUpdate();
                        }
                    }

                    this._readPulseAudioEvent();
                } catch (e) {
                    log("Error reading pulseAudio: " + e);
                }
            }
        );
    }

    _fullUpdate() {
        if (this._updateTimerId) {
            GLib.source_remove(this._updateTimerId);
        }
        this._updateTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 50, () => {
            this._updateTimerId = null;
            this._doFullUpdate();
            return GLib.SOURCE_REMOVE;
        });
    }

    _doFullUpdate() {
        // Clear connecting state when any bluetooth sink appears
        if (this._connectingMac && this._getConnectedBtMac()) {
            log("headsetmon: connecting device now connected, clearing state");
            this._connectingMac = null;
            this._spinnerIcon = null;
        }
        this._updateSinkDisplay();
        this._updateProfileDisplay();
        this._updateAvailableDevices();
    }

    _isBluetoothCard(card) {
        return !!(card && card.properties && card.properties["device.bus"] === "bluetooth");
    }

    _isBluetoothSink(sink) {
        if (!sink) return false;
        return this._isBluetoothCard(this._cards[sink.card]);
    }

    _getAnyBluetoothSink() {
        return Array.from(this._sinks.values()).find(sink => this._isBluetoothSink(sink));
    }

    _getActiveBluetoothSink() {
        return Array.from(this._sinks.values()).find(
            sink => sink.name === this._defaultSinkName && this._isBluetoothSink(sink)
        );
    }

    _getBuiltinSink() {
        return Array.from(this._sinks.values()).find(
            sink => !this._isBluetoothSink(sink)
        );
    }

    _getSinkDisplay(sinkId, sink, isActiveSink) {

        // Icon
        let isBluetoothSink = this._isBluetoothSink(sink);
        let iconName = isBluetoothSink ? "audio-headphones" : "audio-speakers";
        let sinkIcon = new St.Icon({ icon_name: iconName, icon_size: 18 });
        let sinkIconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
        sinkIconWrap.add_actor(sinkIcon);

        // Label
        let sinkLabelBox = new St.BoxLayout({ vertical: true, style_class: "label", x_expand: true });
        let sinkNameLabel = new St.Label({ text: sink.description, style_class: "name" });
        sinkLabelBox.add_actor(sinkNameLabel);

        // Sink display layout
        let sinkLabelLayout = new St.BoxLayout({ style_class: "output-item-layout" });
        sinkLabelLayout.add_actor(sinkIconWrap);
        sinkLabelLayout.add_actor(sinkLabelBox);

        // If sink is active, display a checkbox icon
        if (isActiveSink) {
            let checkIcon = new St.Icon({ icon_name: "object-select-symbolic", icon_size: 16 });
            sinkLabelLayout.add_actor(checkIcon);

            // The active Bluetooth device also gets a disconnect button next to the tick
            if (isBluetoothSink) {
                let disconnectBtn = new St.Button({
                    style_class: "icon-btn",
                    button_mask: St.ButtonMask.ONE
                });
                disconnectBtn.add_actor(new St.Icon({ icon_name: "window-close-symbolic", icon_size: 14 }));
                disconnectBtn.connect("clicked", () => this._onDisconnect());
                sinkLabelLayout.add_actor(disconnectBtn);
            }
        }

        let card = this._cards[sink.card];
        let showProfiles = this._showsProfileToggle(sink, card);

        // Bluetooth device with profiles
        let sinkButton = new St.Button({
            style_class: "output-item",
            button_mask: St.ButtonMask.ONE,
            x_fill: true,
            x_expand: true
        });
        if (isActiveSink) {
            sinkButton.add_style_class_name("selected");
        }
        sinkButton.connect("clicked", () => this._selectSink(sinkId));

        if (showProfiles) {
            // If this is a bluetooth sink, then we need a container for the additional profile toggle buttons
            let sinkContent = new St.BoxLayout({ vertical: true, x_expand: true });
            sinkContent.add_actor(sinkLabelLayout);
            sinkContent.add_actor(this._buildProfileToggle(card));
            sinkButton.add_actor(sinkContent);
        } else {
            sinkButton.add_actor(sinkLabelLayout);
        }

        return sinkButton;
    }

    _showsProfileToggle(sink, card) {
        if (!this._isBluetoothSink(sink) || !card || !card.profiles) {
            return false;
        }
        let hasHighQuality = card.profiles.some(p => p.name === HIGH_QUALITY_PROFILE);
        let hasHeadset = card.profiles.some(p => p.name === HEADSET_PROFILE);
        return hasHighQuality && hasHeadset;
    }

    _buildProfileToggle(card) {
        let activeProfileName = card.active_profile && card.active_profile.name;

        let profiles = [
            { name: HIGH_QUALITY_PROFILE, cssClass: "hq", label: "High quality", icon: "audio-speakers-symbolic" },
            { name: HEADSET_PROFILE, cssClass: "mic", label: "Microphone", icon: "audio-input-microphone-symbolic" }
        ];

        let profileToggleWrap = new St.BoxLayout({ vertical: true, style_class: "profile-toggle-wrap", x_expand: true });
        let profileToggle = new St.BoxLayout({ style_class: "profile-toggle", x_expand: true });

        for (const profile of profiles) {
            let button = new St.Button({
                style_class: "profile-btn " + profile.cssClass,
                button_mask: St.ButtonMask.ONE,
                x_expand: true
            });
            if (activeProfileName === profile.name) {
                button.add_style_class_name("selected");
            }

            let buttonContent = new St.BoxLayout({ style_class: "profile-btn-content" });
            buttonContent.add_actor(new St.Icon({ icon_name: profile.icon, icon_size: 17 }));
            buttonContent.add_actor(new St.Label({ text: profile.label }));
            button.add_actor(buttonContent);

            button.connect("clicked", () => this._setCardProfile(card, profile.name));
            profileToggle.add_actor(button);
        }

        profileToggleWrap.add_actor(profileToggle);
        return profileToggleWrap;
    }

    _setCardProfile(card, profileName) {
        if (!card || !card.name) return;
        GLib.spawn_command_line_async("pactl set-card-profile " + card.name + " " + profileName);
    }

    _updateHeader(activeSink) {
        if (!activeSink) {
            log("headsetmon: _updateHeader — activeSink not found for defaultSinkName=" + this._defaultSinkName);
            return;
        }

        this._deviceName.set_text(activeSink.description);

        if (this._isBluetoothSink(activeSink)) {
            this._deviceIcon.set_icon_name("audio-headphones");
            // Show the green connected badge if this is a bluetooth sink
            this._statusBadge.show();

            let card = this._cards[activeSink.card];
            let profileDesc = card && card.active_profile && card.active_profile.description;
            if (profileDesc && profileDesc.indexOf("High Fidelity") !== -1) {
                this._deviceSubtitle.set_text("Connected · High quality audio");
            } else if (profileDesc && profileDesc.indexOf("Headset") !== -1) {
                this._deviceSubtitle.set_text("Connected · Microphone enabled");
            } else {
                this._deviceSubtitle.set_text(profileDesc ? "Connected · " + profileDesc : "Connected");
            }
            this._deviceSubtitle.show();
        } else {
            this._deviceIcon.set_icon_name("audio-speakers");
            this._statusBadge.hide();
            this._deviceSubtitle.hide();
        }
    }

    _updateAvailableSinkList() {
        // Remove all current items from the output list
        this._outputList.destroy_all_children();

        for (const [sinkId, sink] of this._sinks) {
            let name = sink.name;
            let card = sink.card;
            let description = sink.description;
            console.log("Sink: ", sinkId, name, card, description);

            let isActiveSink = name === this._defaultSinkName;

            this._outputList.add_actor(this._getSinkDisplay(sinkId, sink, isActiveSink));
        }
    }

    _updateSinkDisplay() {
        try {
            let activeSink = Array.from(this._sinks.values()).find(
                s => s.name === this._defaultSinkName
            );

            // ── Header ──
            this._updateHeader(activeSink);

            // ── Available sinks list ──
            this._updateAvailableSinkList();

        } catch (e) {
            log("headsetmon: ERROR in _updateSinkDisplay: " + e + " " + e.stack);
        }
    }

    _updateProfileDisplay() {
        // Profile state is now handled inside _updateSinkDisplay
    }

    _updateAvailableDevices() {
        try {
            let connectedMac = this._getConnectedBtMac();
            let otherDevices = this._bondedDevices.filter(
                dev => !connectedMac || dev.mac.toUpperCase() !== connectedMac.toUpperCase()
            );

            this._availableContainer.destroy_all_children();

            if (otherDevices.length === 0) {
                this._availableSectionLabel.hide();
                return;
            }

            this._availableSectionLabel.show();

            for (let dev of otherDevices) {
                let isConnecting = this._connectingMac &&
                    dev.mac.toUpperCase() === this._connectingMac.toUpperCase();

                let itemRow = new St.BoxLayout({ style_class: "available-item" });

                let iconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
                iconWrap.add_actor(new St.Icon({ icon_name: "bluetooth-symbolic", icon_size: 18 }));

                let labelBox = new St.BoxLayout({ vertical: true, style_class: "label", x_expand: true });
                labelBox.add_actor(new St.Label({ text: dev.name, style_class: "name" }));

                itemRow.add_actor(iconWrap);
                itemRow.add_actor(labelBox);

                if (isConnecting) {
                    this._spinnerIcon = new St.Icon({
                        icon_name: "process-working-symbolic",
                        icon_size: 16,
                        style_class: "spinner-icon"
                    });
                    this._spinnerIcon.set_pivot_point(0.5, 0.5);
                    this._spinnerIcon.rotation_angle_z = this._spinnerAngle;
                    itemRow.add_actor(this._spinnerIcon);
                    let connectBtn = new St.Button({
                        label: "Connecting",
                        style_class: "connect-btn connecting",
                        button_mask: St.ButtonMask.ONE
                    });
                    connectBtn.sensitive = false;
                    itemRow.add_actor(connectBtn);
                } else {
                    let connectBtn = new St.Button({
                        label: "Connect",
                        style_class: "connect-btn",
                        button_mask: St.ButtonMask.ONE
                    });
                    connectBtn.connect("clicked", () => this._onConnectBondedDevice(dev.mac));
                    itemRow.add_actor(connectBtn);
                }

                this._availableContainer.add_actor(itemRow);
            }
        } catch (e) {
            log("headsetmon: ERROR in _updateAvailableDevices: " + e + " " + e.stack);
        }
    }

    // Previously-paired Bluetooth devices, read from bluetoothctl without blocking the UI
    _readBondedDevices() {
        try {
            let proc = new Gio.Subprocess({
                argv: ["bluetoothctl", "devices", "Bonded"],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            proc.init(null);
            proc.communicate_utf8_async(null, null, (p, res) => {
                try {
                    let [, stdout] = p.communicate_utf8_finish(res);
                    this._bondedDevices = this._parseBondedDevices(stdout || "");
                } catch (e) {
                    log("headsetmon: ERROR reading bonded devices: " + e);
                }
                this._updateAvailableDevices();
            });
        } catch (e) {
            log("headsetmon: ERROR spawning bluetoothctl: " + e);
        }
    }

    _parseBondedDevices(text) {
        let devices = [];
        for (let line of text.split("\n")) {
            // bluetoothctl prints "Device <MAC> <Name>"
            let match = line.trim().match(/^Device\s+([0-9A-F:]{17})\s*(.*)$/i);
            if (match) {
                devices.push({ mac: match[1].toUpperCase(), name: match[2] || match[1] });
            }
        }
        return devices;
    }

    _getConnectedBtMac() {
        let sink = this._getAnyBluetoothSink();
        if (!sink) return null;
        let card = this._cards[sink.card];
        return card && card.properties ? card.properties["device.string"] : null;
    }

    _onConnectBondedDevice(mac) {
        log("headsetmon: connecting bonded device " + mac);
        this._connectingMac = mac;
        this._spinnerAngle = 0;
        this._spinnerIcon = null;
        // Start spinner animation — ticks independently of PA events
        if (!this._spinnerTimerId) {
            this._spinnerTimerId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, 15, () => {
                if (!this._connectingMac) {
                    this._spinnerTimerId = 0;
                    return GLib.SOURCE_REMOVE;
                }
                this._spinnerAngle = (this._spinnerAngle + 5) % 360;
                if (this._spinnerIcon) {
                    this._spinnerIcon.rotation_angle_z = this._spinnerAngle;
                }
                return GLib.SOURCE_CONTINUE;
            });
        }
        this._fullUpdate();
        GLib.spawn_command_line_async("bluetoothctl connect " + mac);
        // Fallback refresh in case PA events are delayed
        GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
            this._fullUpdate();
            return false;
        });
    }

    _selectSink(sinkIndex) {
        try {
            let sink = this._sinks.get(sinkIndex);
            if (!sink) {
                log("headsetmon: _selectSink — sink not found for index " + sinkIndex);
                return;
            }
            log("headsetmon: _selectSink index=" + sinkIndex + " name=" + sink.name);
            GLib.spawn_command_line_async(
                "pactl set-default-sink " + sink.name
            );
            log("headsetmon: _selectSink ran pactl set-default-sink " + sink.name);
        } catch (e) {
            log("headsetmon: ERROR in _selectSink: " + e);
        }
    }

    _onDisconnect() {
        let headphoneSink = this._getActiveBluetoothSink();
        if (!headphoneSink) return;

        let card = this._cards[headphoneSink.card];
        if (!card || !card.properties) return;

        let mac = card.properties["device.string"];
        if (mac) {
            this._disconnectedBtMac = mac;
            log("headsetmon: _onDisconnect saved mac=" + mac);
            GLib.spawn_command_line_async("bluetoothctl disconnect " + mac);
        }
    }

    on_desklet_removed(deleteConfig) {
        if (this._spinnerTimerId) {
            GLib.source_remove(this._spinnerTimerId);
            this._spinnerTimerId = 0;
        }
        if (this._pulseAudioProcess) {
            this._pulseAudioProcess.force_exit();
            this._pulseAudioProcess = null;
        }
    }
}

function main(metadata, desklet_id) {
    return new DeskClock(metadata, desklet_id);
}