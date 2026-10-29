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
        this._disconnectedBtMac = null;

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

        // Speakers item
        // this._speakersCheck = new St.Icon({ icon_name: "object-select-symbolic", icon_size: 16 });
        //
        // let speakersLabelBox = new St.BoxLayout({ vertical: true, style_class: "label" });
        // this._speakersNameLabel = new St.Label({ text: "Speakers Built-in Audio", style_class: "name" });
        //
        // let speakersIcon = new St.Icon({ icon_name: "audio-speakers-symbolic", icon_size: 18 });
        // let speakersIconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
        // speakersIconWrap.add_actor(speakersIcon);
        //
        // speakersLabelBox.add_actor(this._speakersNameLabel);
        // this._speakersItem = new St.Button({ style_class: "output-item", button_mask: St.ButtonMask.ONE });
        // let speakersLayout = new St.BoxLayout({ style_class: "output-item-layout" });
        // speakersLayout.add_actor(speakersIconWrap);
        // speakersLayout.add_actor(speakersLabelBox);
        // speakersLayout.add_actor(this._speakersCheck);
        // this._speakersItem.add_actor(speakersLayout);
        // this._speakersItem.connect("clicked", () => this._selectSink("speakers"));
        // this._outputList.add_actor(this._speakersItem);
        //
        //
        // this._btCheck = new St.Icon({ icon_name: "object-select-symbolic", icon_size: 16 });
        //
        // let btLabelBox = new St.BoxLayout({ vertical: true, style_class: "label" });
        // this._btNameLabel = new St.Label({ style_class: "name" });
        // this._btMetaLabel = new St.Label({ style_class: "meta" });
        // btLabelBox.add_actor(this._btNameLabel);
        // btLabelBox.add_actor(this._btMetaLabel);
        //
        // let btIconWidget = new St.Icon({ icon_name: "audio-headphones-symbolic", icon_size: 18 });
        // let btIconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
        // btIconWrap.add_actor(btIconWidget);
        //
        // this._connectBtn = new St.Button({ label: "Connect", style_class: "connect-btn" });
        // this._connectBtn.connect("clicked", () => this._onReconnect());
        // this._disconnectBtn = new St.Button({ style_class: "icon-btn" });
        // let closeIcon = new St.Icon({ icon_name: "window-close-symbolic", icon_size: 14 });
        // this._disconnectBtn.add_actor(closeIcon);
        // this._disconnectBtn.connect("clicked", () => this._onDisconnect());
        //
        // let topLayout = new St.BoxLayout({ style_class: "output-item-layout" });
        // topLayout.add_actor(btIconWrap);
        // topLayout.add_actor(btLabelBox);
        // topLayout.add_actor(this._btCheck);
        // topLayout.add_actor(this._connectBtn);
        // topLayout.add_actor(this._disconnectBtn);
        //
        // // Profile toggle (nested under headphone)
        // this._profileToggleWrap = new St.Widget({ style_class: "profile-toggle-wrap" });
        // this._profileToggle = new St.BoxLayout({ style_class: "profile-toggle" });
        //
        // this._hqBtn = new St.Button({ style_class: "profile-btn", button_mask: St.ButtonMask.ONE });
        // let hqBtnLayout = new St.BoxLayout();
        // let hqIcon = new St.Icon({ icon_name: "audio-speakers-symbolic", icon_size: 17 });
        // hqBtnLayout.add_actor(hqIcon);
        // hqBtnLayout.add_actor(new St.Label({ text: " High quality" }));
        // this._hqBtn.add_actor(hqBtnLayout);
        // this._hqBtn.connect("clicked", () => this._onSetProfile("hq"));
        //
        // this._micBtn = new St.Button({ style_class: "profile-btn", button_mask: St.ButtonMask.ONE });
        // let micBtnLayout = new St.BoxLayout();
        // let micIcon = new St.Icon({ icon_name: "audio-input-microphone-symbolic", icon_size: 17 });
        // micBtnLayout.add_actor(micIcon);
        // micBtnLayout.add_actor(new St.Label({ text: " Microphone" }));
        // this._micBtn.add_actor(micBtnLayout);
        // this._micBtn.connect("clicked", () => this._onSetProfile("mic"));
        //
        // this._profileToggle.add_actor(this._hqBtn);
        // this._profileToggle.add_actor(this._micBtn);
        // this._profileToggleWrap.add_actor(this._profileToggle);
        // this._profileToggleWrap.hide();

        this._btDynamicContainer = new St.BoxLayout({ vertical: true });
        this._outputList.add_actor(this._btDynamicContainer);
        this._container.add_actor(this._outputList);

        // ─── Available devices section ──────────────────────────
        this._availableSlot = new St.BoxLayout({ vertical: true });
        this._availableSectionLabel = new St.Label({
            text: "Available devices",
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
                argv: ["/home/alex/dev/cpp/paeventmon/cmake-build-debug/paeventmon"],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });
            this._pulseAudioProcess.init(null);
            let stdout = this._pulseAudioProcess.get_stdout_pipe();
            this._pulseAudioStream = new Gio.DataInputStream({
                base_stream: stdout
            });
            this._readPulseAudioEvent();

            log("headsetmon: Running initial fullUpdate");
            this._fullUpdate();
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

                    let on = evt.on;
                    let event = evt.event;

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
                            }
                            this._fullUpdate();
                        } else if (on === "card" && event === "change" && evt.prop === "active_profile.name") {
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
                            delete this._knownBtCards[evt.index];
                            delete this._cards[evt.index];
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
        this._updateSinkDisplay();
        this._updateProfileDisplay();
        this._updateAvailableDevices();
    }

    _isBluetoothSink(sink) {
        if (!sink) return false;
        let card = this._cards[sink.card];
        return card && card.properties && card.properties["device.bus"] === "bluetooth";
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
        }

        let card = this._cards[sink.card];
        let showProfiles = this._showsProfileToggle(sink, card);

        // Main container for the sink is a button. Clicking allows the user to switch the active sink
        let sinkContainer = new St.Button({
            style_class: showProfiles ? "bt-item-top" : "output-item",
            button_mask: St.ButtonMask.ONE,
            x_fill: true,
            x_expand: true
        });
        sinkContainer.add_actor(sinkLabelLayout);
        sinkContainer.connect("clicked", () => this._selectSink(sinkId));

        if (!showProfiles) {
            return sinkContainer;
        }

        // Bluetooth device with selectable profiles: keep the sink row and add a profile picker beneath it
        let sinkItem = new St.BoxLayout({ vertical: true, style_class: "bt-item", x_expand: true });
        if (isActiveSink) {
            sinkItem.add_style_class_name("active");
        }
        sinkItem.add_actor(sinkContainer);
        sinkItem.add_actor(this._buildProfileToggle(card));

        return sinkItem;
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
                button.add_style_class_name("active");
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

            // ── Output list: speakers ──
            // this._speakersNameLabel.set_text(
            //     builtinSink ? (builtinSink.description || "Speakers Built-in Audio") : "Speakers Built-in Audio"
            // );
            // if (!activeSinkIsBt) {
            //     this._speakersItem.set_style_class_name("output-item active");
            //     this._speakersCheck.set_icon_name("object-select-symbolic");
            // } else {
            //     this._speakersItem.set_style_class_name("output-item");
            //     this._speakersCheck.set_icon_name("");
            // }


            // ── Output list: bluetooth devices ──

            // this._btDynamicContainer.destroy_all_children();
            // this._btDynamicContainer.show();
            // log("headsetmon: Listing bonded devices...");
            // let devicesToShow = [];
            // let connectedBtMac = null;
            //
            // // Determine connected BT MAC and look up card info
            // if (headphoneSink) {
            //     let card = this._cards[headphoneSink.card];
            //     if (card && card.properties) {
            //         connectedBtMac = card.properties["device.string"];
            //     }
            // }
            //
            // // Build device entries: known PA cards first, then bonded
            // for (let idx in this._knownBtCards) {
            //     let c = this._knownBtCards[idx];
            //     let mac = c.mac;
            //     // Look up card info for profile support
            //     let card = null;
            //     for (let ci in this._cards) {
            //         if (this._cards[ci].name === c.name) {
            //             card = this._cards[ci];
            //             break;
            //         }
            //     }
            //     let microphoneAvail = false;
            //     let hqAvail = false;
            //     if (card && card.profiles) {
            //         microphoneAvail = card.profiles.some(p => p.name === HEADSET_PROFILE && p.available === 1);
            //         hqAvail = card.profiles.some(p => p.name === HIGH_QUALITY_PROFILE && p.available === 1);
            //     }
            //     if (mac && !devicesToShow.some(d => d.mac === mac)) {
            //         devicesToShow.push({
            //             name: c.description || c.name,
            //             mac: mac,
            //             type: "pactl",
            //             cardName: c.name,
            //             card: card,
            //             microphoneAvail: microphoneAvail,
            //             hqAvail: hqAvail
            //         });
            //     }
            // }
            //
            // // Add bonded bluetooth devices
            // try {
            //     let [ok, stdoutBytes, stderrBytes, exitStatus] = GLib.spawn_command_line_sync(
            //         "bluetoothctl devices Bonded"
            //     );
            //     if (stdoutBytes && stdoutBytes.length > 0) {
            //         let text = "";
            //         try { text = new TextDecoder().decode(stdoutBytes); }
            //         catch (_) { text = String.fromCharCode.apply(null, stdoutBytes); }
            //         for (let line of text.split('\n')) {
            //             if (line.trim() === "") continue;
            //             let parts = line.split(' ');
            //             let mac = parts[1];
            //             let name = parts.slice(2).join(' ');
            //             if (mac && !devicesToShow.some(d => d.mac === mac)) {
            //                 devicesToShow.push({ name: name || mac, mac: mac, type: "bluetoothctl" });
            //             }
            //         }
            //     }
            // } catch (e) {
            //     log("headsetmon: error reading bluetoothctl devices Bonded: " + e);
            // }
            //
            // // Render every device identically
            // for (let dev of devicesToShow) {
            //     let isActive = dev.mac === connectedBtMac && activeSinkIsBt;
            //     let isConnected = dev.mac === connectedBtMac;
            //
            //     log("headsetmon: " + (isActive ? "[active] " : "") + (isConnected ? "[connected] " : "") + "device: " + dev.name + " (" + dev.mac + ")");
            //
            //     // Outer container: bt-item
            //     let btItem = new St.BoxLayout({ vertical: true, style_class: "output-item bt-item" + (isActive ? " active" : "") });
            //
            //     // Top row
            //     let topRow = new St.Button({ style_class: "bt-item-top", button_mask: St.ButtonMask.ONE });
            //     let topLayout = new St.BoxLayout({ style_class: "output-item-layout" });
            //
            //     let iconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
            //     let btIcon = new St.Icon({ icon_name: "audio-headphones-symbolic", icon_size: 18 });
            //     iconWrap.add_actor(btIcon);
            //
            //     let labelBox = new St.BoxLayout({ vertical: true, style_class: "label" });
            //     let nameLabel = new St.Label({ text: dev.name || "Bluetooth device", style_class: "name" });
            //     let metaLabel = new St.Label({ text: "Disconnected", style_class: "meta" });
            //     labelBox.add_actor(nameLabel);
            //     labelBox.add_actor(metaLabel);
            //
            //     // Checkmark (only for active)
            //     let checkIcon = new St.Icon({ icon_name: isActive ? "object-select-symbolic" : "", icon_size: 16 });
            //
            //     // Connect/disconnect buttons
            //     let discBtn = new St.Button({ style_class: "icon-btn" });
            //     let closeIcon = new St.Icon({ icon_name: "window-close-symbolic", icon_size: 14 });
            //     discBtn.add_actor(closeIcon);
            //     discBtn.connect("clicked", () => {
            //         if (isConnected && isActive) {
            //             // Disconnect
            //             let sink = this._getActiveBluetoothSink();
            //             if (sink) {
            //                 let card = this._cards[sink.card];
            //                 if (card && card.properties) {
            //                     this._disconnectedBtMac = card.properties["device.string"];
            //                     GLib.spawn_command_line_async("bluetoothctl disconnect " + this._disconnectedBtMac);
            //                 }
            //             }
            //         }
            //     });
            //
            //     let cnctBtn = new St.Button({ label: "Connect", style_class: "connect-btn" });
            //     cnctBtn.connect("clicked", () => {
            //         this._disconnectedBtMac = dev.mac;
            //         if (dev.type === "pactl" && dev.cardName) {
            //             GLib.spawn_command_line_async("pactl set-card-profile " + dev.cardName + " " + HIGH_QUALITY_PROFILE);
            //         } else {
            //             GLib.spawn_command_line_async("bluetoothctl connect " + dev.mac);
            //         }
            //         this._fullUpdate();
            //     });
            //
            //     // Set visibility
            //     if (isConnected) {
            //         discBtn.show();
            //         cnctBtn.hide();
            //         // Set meta text based on profile
            //         if (dev.card && dev.card.active_profile) {
            //             let pd = dev.card.active_profile.description;
            //             if (pd && pd.indexOf("High Fidelity Playback") !== -1) {
            //                 metaLabel.set_text("High quality audio");
            //             } else if (pd && pd.indexOf("Headset Head Unit") !== -1) {
            //                 metaLabel.set_text("Microphone enabled");
            //             } else {
            //                 metaLabel.set_text(pd || "Connected");
            //             }
            //         } else {
            //             metaLabel.set_text("Connected");
            //         }
            //     } else {
            //         discBtn.hide();
            //         cnctBtn.show();
            //         metaLabel.set_text("Disconnected");
            //     }
            //
            //     topLayout.add_actor(iconWrap);
            //     topLayout.add_actor(labelBox);
            //     topLayout.add_actor(checkIcon);
            //     topLayout.add_actor(cnctBtn);
            //     topLayout.add_actor(discBtn);
            //     topRow.add_actor(topLayout);
            //     btItem.add_actor(topRow);
            //
            //     // Profile toggle (if connected and card has profile info)
            //     if (isConnected && dev.card && (dev.microphoneAvail || dev.hqAvail)) {
            //         let toggleWrap = new St.Widget({ style_class: "profile-toggle-wrap" });
            //         let toggle = new St.BoxLayout({ style_class: "profile-toggle" });
            //
            //         let hqBtn = new St.Button({ style_class: "profile-btn", button_mask: St.ButtonMask.ONE });
            //         let hqLayout = new St.BoxLayout();
            //         let hqIc = new St.Icon({ icon_name: "audio-speakers-symbolic", icon_size: 17 });
            //         hqLayout.add_actor(hqIc);
            //         hqLayout.add_actor(new St.Label({ text: " High quality" }));
            //         hqBtn.add_actor(hqLayout);
            //
            //         let micBtn = new St.Button({ style_class: "profile-btn", button_mask: St.ButtonMask.ONE });
            //         let micLayout = new St.BoxLayout();
            //         let micIc = new St.Icon({ icon_name: "audio-input-microphone-symbolic", icon_size: 17 });
            //         micLayout.add_actor(micIc);
            //         micLayout.add_actor(new St.Label({ text: " Microphone" }));
            //         micBtn.add_actor(micLayout);
            //
            //         // Highlight active
            //         let activeProfile = dev.card.active_profile;
            //         if (activeProfile) {
            //             if (activeProfile.name === HIGH_QUALITY_PROFILE) {
            //                 hqBtn.set_style_class_name("profile-btn hq active");
            //                 micBtn.set_style_class_name("profile-btn mic");
            //             } else if (activeProfile.name === HEADSET_PROFILE) {
            //                 micBtn.set_style_class_name("profile-btn mic active");
            //                 hqBtn.set_style_class_name("profile-btn hq");
            //             } else {
            //                 hqBtn.set_style_class_name("profile-btn");
            //                 micBtn.set_style_class_name("profile-btn");
            //             }
            //         }
            //
            //         hqBtn.connect("clicked", () => {
            //             if (dev.cardName) {
            //                 GLib.spawn_command_line_async("pactl set-card-profile " + dev.cardName + " " + HIGH_QUALITY_PROFILE);
            //             }
            //         });
            //         micBtn.connect("clicked", () => {
            //             if (dev.cardName) {
            //                 GLib.spawn_command_line_async("pactl set-card-profile " + dev.cardName + " " + HEADSET_PROFILE);
            //             }
            //         });
            //
            //         toggle.add_actor(hqBtn);
            //         toggle.add_actor(micBtn);
            //         toggleWrap.add_actor(toggle);
            //         btItem.add_actor(toggleWrap);
            //     }
            //
            //     // Top-row click: switch to this device or reconnect
            //     topRow.connect("clicked", () => {
            //         try {
            //             if (isConnected) {
            //                 log("headsetmon: clicking connected device, calling _selectSink('headphones')");
            //                 this._selectSink("headphones");
            //             } else {
            //                 log("headsetmon: clicking disconnected device, reconnecting " + dev.mac);
            //                 this._disconnectedBtMac = dev.mac;
            //                 if (dev.type === "pactl" && dev.cardName) {
            //                     GLib.spawn_command_line_async("pactl set-card-profile " + dev.cardName + " " + HIGH_QUALITY_PROFILE);
            //                 } else {
            //                     GLib.spawn_command_line_async("bluetoothctl connect " + dev.mac);
            //                 }
            //                 this._fullUpdate();
            //             }
            //         } catch (e) {
            //             log("headsetmon: ERROR in topRow click: " + e + " " + e.stack);
            //         }
            //     });
            //
            //     this._btDynamicContainer.add_actor(btItem);
            // }
        } catch (e) {
            log("headsetmon: ERROR in _updateSinkDisplay: " + e + " " + e.stack);
        }
    }

    _updateProfileDisplay() {
        // Profile state is now handled inside _updateSinkDisplay
    }

    _updateAvailableDevices() {
        try {
        // Find Bluetooth cards that don't have a corresponding sink
        let btCards = {};
        for (let idx in this._cards) {
            let card = this._cards[idx];
            if (card.properties && card.properties["device.bus"] === "bluetooth") {
                btCards[idx] = card;
            }
        }

        // Remove cards that are already known (shown in output list)
        for (let idx in this._knownBtCards) {
            delete btCards[idx];
        }

        let cardKeys = Object.keys(btCards);
        if (cardKeys.length > 0) {
            this._availableSectionLabel.show();
            this._availableContainer.destroy_all_children();

            for (let idx of cardKeys) {
                let card = btCards[idx];
                let itemRow = new St.BoxLayout({ style_class: "available-item" });

                let iconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
                let btIcon = new St.Icon({ icon_name: "bluetooth-symbolic", icon_size: 18 });
                iconWrap.add_actor(btIcon);

                let labelBox = new St.BoxLayout({ vertical: true, style_class: "label" });
                let nameLabel = new St.Label({
                    text: card.properties["device.description"] || card.name || "Unknown device",
                    style_class: "name"
                });
                let metaLabel = new St.Label({
                    text: card.properties["device.form_factor"] || "Bluetooth",
                    style_class: "meta"
                });
                labelBox.add_actor(nameLabel);
                labelBox.add_actor(metaLabel);

                let connectBtn = new St.Button({
                    label: "Connect",
                    style_class: "connect-btn"
                });
                connectBtn.cardIdx = idx;
                connectBtn.connect("clicked", () => this._onConnectDevice(idx));

                itemRow.add_actor(iconWrap);
                itemRow.add_actor(labelBox);
                itemRow.add_actor(connectBtn);
                this._availableContainer.add_actor(itemRow);
            }
        } else {
            this._availableSectionLabel.hide();
            this._availableContainer.destroy_all_children();
        }
    } catch (e) {
        log("headsetmon: ERROR in _updateAvailableDevices: " + e + " " + e.stack);
    }
    }

    _selectSink(type) {
        try {
            log("headsetmon: _selectSink type=" + type);
            if (type === "headphones") {
                let headphoneSink = this._getAnyBluetoothSink();
                log("headsetmon: _selectSink headphoneSink=" + (headphoneSink ? headphoneSink.name : "null"));
                if (headphoneSink) {
                    GLib.spawn_command_line_async(
                        "pactl set-default-sink " + headphoneSink.name
                    );
                    log("headsetmon: _selectSink ran pactl set-default-sink " + headphoneSink.name);
                }
            } else if (type === "speakers") {
                let builtinSink = this._getBuiltinSink();
                if (builtinSink) {
                    GLib.spawn_command_line_async(
                        "pactl set-default-sink " + builtinSink.name
                    );
                }
            }
        } catch (e) {
            log("headsetmon: ERROR in _selectSink: " + e);
        }
    }

    _onSetProfile(profile) {
        let headphoneSink = this._getActiveBluetoothSink();
        if (!headphoneSink) return;

        let card = this._cards[headphoneSink.card];
        if (!card) return;

        if (profile === "hq") {
            this._setCardProfile(card, HIGH_QUALITY_PROFILE);
        } else if (profile === "mic") {
            this._setCardProfile(card, HEADSET_PROFILE);
        }
    }

    _onBtItemClicked() {
        try {
            log("headsetmon: _onBtItemClicked called");
            let btSink = this._getAnyBluetoothSink();
            log("headsetmon: _getAnyBluetoothSink() = " + (btSink ? btSink.name : "null"));
            if (btSink) {
                log("headsetmon: calling _selectSink('headphones')");
                this._selectSink("headphones");
            } else {
                log("headsetmon: calling _onReconnect()");
                this._onReconnect();
            }
        } catch (e) {
            log("headsetmon: ERROR in _onBtItemClicked: " + e);
        }
    }

    _onReconnect() {
        try {
            let btCardIdx = Object.keys(this._knownBtCards)[0];
            log("headsetmon: _onReconnect btCardIdx=" + (btCardIdx || "null")
                + " knownBtCards=" + Object.keys(this._knownBtCards).length);
            if (btCardIdx) {
                let btCard = this._knownBtCards[btCardIdx];
                log("headsetmon: reconnecting via known card " + btCard.name);
                GLib.spawn_command_line_async(
                    "pactl set-card-profile " + btCard.name + " " + HIGH_QUALITY_PROFILE
                );
                delete this._knownBtCards[btCardIdx];
                return;
            }

            if (this._disconnectedBtMac) {
                log("headsetmon: reconnecting via bluetoothctl connect " + this._disconnectedBtMac);
                GLib.spawn_command_line_async(
                    "bluetoothctl connect " + this._disconnectedBtMac
                );
                this._disconnectedBtMac = null;
            }

            // Schedule a refresh after reconnection to pick up PA state changes
            GLib.timeout_add(GLib.PRIORITY_DEFAULT, 3000, () => {
                log("headsetmon: delayed refresh after reconnect");
                this._fullUpdate();
                return false;
            });
        } catch (e) {
            log("headsetmon: ERROR in _onReconnect: " + e);
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

    _onConnectDevice(cardIdx) {
        let card = this._cards[cardIdx];
        if (!card) return;

        GLib.spawn_command_line_async("pactl set-card-profile " + card.name + " " + HIGH_QUALITY_PROFILE);
    }

    on_desklet_removed(deleteConfig) {
        if (this._pulseAudioProcess) {
            this._pulseAudioProcess.force_exit();
            this._pulseAudioProcess = null;
        }
    }
}

function main(metadata, desklet_id) {
    return new DeskClock(metadata, desklet_id);
}