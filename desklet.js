const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Desklet = imports.ui.desklet;

const UUID = "headsetmon@bytepath";

const HEADSET_PROFILE = "headset-head-unit-msbc";
const HIGH_QUALITY_PROFILE = "a2dp-sink";

class DeskClock extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this._timeoutId = 0;
        this._entityInfo = {};
        this._sinks = {};
        this._defaultSinkName = null;
        this._sinkIndexToName = {};
        this._cards = {};

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
        this._deviceSubtitle = new St.Label({ style_class: "device-subtitle" });
        this._deviceSubtitle.hide();

        let deviceInfo = new St.BoxLayout({
            vertical: true,
            style_class: "device-info"
        });
        deviceInfo.add_actor(this._deviceName);
        deviceInfo.add_actor(this._deviceSubtitle);

        let deviceRow = new St.BoxLayout({
            style_class: "device-row"
        });
        deviceRow.add_actor(this._deviceIconBox);
        deviceRow.add_actor(deviceInfo);
        this._container.add_actor(deviceRow);

        // ─── Section label: Output device ───────────────────────
        this._outputSectionLabel = new St.Label({
            text: "Output device",
            style_class: "section-label"
        });
        this._container.add_actor(this._outputSectionLabel);

        // ─── Output list ────────────────────────────────────────
        this._outputList = new St.BoxLayout({
            vertical: true,
            style_class: "output-list"
        });

        // Speakers item
        this._speakersCheck = new St.Icon({ icon_name: "object-select-symbolic", icon_size: 16 });

        let speakersLabelBox = new St.BoxLayout({ vertical: true, style_class: "label" });
        this._speakersNameLabel = new St.Label({ text: "Speakers Built-in Audio", style_class: "name" });

        let speakersIcon = new St.Icon({ icon_name: "audio-speakers-symbolic", icon_size: 18 });
        let speakersIconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
        speakersIconWrap.add_actor(speakersIcon);

        speakersLabelBox.add_actor(this._speakersNameLabel);
        this._speakersItem = new St.Button({ style_class: "output-item", button_mask: St.ButtonMask.ONE });
        let speakersLayout = new St.BoxLayout({ style_class: "output-item-layout" });
        speakersLayout.add_actor(speakersIconWrap);
        speakersLayout.add_actor(speakersLabelBox);
        speakersLayout.add_actor(this._speakersCheck);
        this._speakersItem.add_actor(speakersLayout);
        this._speakersItem.connect("clicked", () => this._selectSink("speakers"));
        this._outputList.add_actor(this._speakersItem);

        // Bluetooth headphone item (nested: top row + profile toggle)
        this._btItem = new St.BoxLayout({
            vertical: true,
            style_class: "output-item bt-item"
        });

        // Top row (clickable)
        this._btCheck = new St.Icon({ icon_name: "object-select-symbolic", icon_size: 16 });

        let btLabelBox = new St.BoxLayout({ vertical: true, style_class: "label" });
        this._btNameLabel = new St.Label({ style_class: "name" });
        this._btMetaLabel = new St.Label({ style_class: "meta" });
        btLabelBox.add_actor(this._btNameLabel);
        btLabelBox.add_actor(this._btMetaLabel);

        let btIconWidget = new St.Icon({ icon_name: "audio-headphones-symbolic", icon_size: 18 });
        let btIconWrap = new St.Widget({ style_class: "icon", layout_manager: new Clutter.BinLayout() });
        btIconWrap.add_actor(btIconWidget);

        this._disconnectBtn = new St.Button({ style_class: "icon-btn" });
        let closeIcon = new St.Icon({ icon_name: "window-close-symbolic", icon_size: 14 });
        this._disconnectBtn.add_actor(closeIcon);
        this._disconnectBtn.connect("clicked", () => this._onDisconnect());

        this._btItemTop = new St.Button({ style_class: "bt-item-top", button_mask: St.ButtonMask.ONE });
        let topLayout = new St.BoxLayout({ style_class: "output-item-layout" });
        topLayout.add_actor(btIconWrap);
        topLayout.add_actor(btLabelBox);
        topLayout.add_actor(this._btCheck);
        topLayout.add_actor(this._disconnectBtn);
        this._btItemTop.add_actor(topLayout);
        this._btItemTop.connect("clicked", () => this._selectSink("headphones"));
        this._btItem.add_actor(this._btItemTop);

        // Profile toggle (nested under headphone)
        this._profileToggleWrap = new St.Widget({ style_class: "profile-toggle-wrap" });
        this._profileToggle = new St.BoxLayout({ style_class: "profile-toggle" });

        this._hqBtn = new St.Button({ style_class: "profile-btn", button_mask: St.ButtonMask.ONE });
        let hqBtnLayout = new St.BoxLayout();
        let hqIcon = new St.Icon({ icon_name: "audio-speakers-symbolic", icon_size: 17 });
        hqBtnLayout.add_actor(hqIcon);
        hqBtnLayout.add_actor(new St.Label({ text: " High quality" }));
        this._hqBtn.add_actor(hqBtnLayout);
        this._hqBtn.connect("clicked", () => this._onSetProfile("hq"));

        this._micBtn = new St.Button({ style_class: "profile-btn", button_mask: St.ButtonMask.ONE });
        let micBtnLayout = new St.BoxLayout();
        let micIcon = new St.Icon({ icon_name: "audio-input-microphone-symbolic", icon_size: 17 });
        micBtnLayout.add_actor(micIcon);
        micBtnLayout.add_actor(new St.Label({ text: " Microphone" }));
        this._micBtn.add_actor(micBtnLayout);
        this._micBtn.connect("clicked", () => this._onSetProfile("mic"));

        this._profileToggle.add_actor(this._hqBtn);
        this._profileToggle.add_actor(this._micBtn);
        this._profileToggleWrap.add_actor(this._profileToggle);
        this._btItem.add_actor(this._profileToggleWrap);
        this._profileToggleWrap.hide();

        this._outputList.add_actor(this._btItem);
        this._btItem.hide();

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
                            this._sinks[evt.index] = {
                                name: evt.name,
                                card: evt.card,
                                description: evt.description
                            };
                            this._fullUpdate();
                        } else if (on === "sink" && event === "change" && evt.prop === "description") {
                            if (this._sinks[evt.index]) {
                                this._sinks[evt.index].description = evt.new;
                                this._fullUpdate();
                            }
                        } else if (on === "server" && evt.default_sink_name) {
                            this._defaultSinkName = evt.default_sink_name;
                            this._fullUpdate();
                        } else if (on === "server" && event === "change" && evt.prop === "default_sink_name") {
                            this._defaultSinkName = evt.new;
                            this._fullUpdate();
                        } else if (on === "card" && event === "new") {
                            this._cards[evt.index] = {
                                name: evt.name,
                                properties: evt.proplist,
                                active_profile: evt.active_profile,
                                profiles: evt.profiles2
                            };
                        } else if (on === "card" && event === "change" && evt.prop === "active_profile.name") {
                            if (this._cards[evt.index]) {
                                this._cards[evt.index].active_profile.name = evt.new;
                            }
                        } else if (on === "card" && event === "change" && evt.prop === "active_profile.description") {
                            if (this._cards[evt.index]) {
                                this._cards[evt.index].active_profile.description = evt.new;
                            }
                        }

                        if (on === "sink" && evt.name) {
                            this._sinkIndexToName[evt.index] = evt.name;
                        }
                    } else if (event === "remove" && on === "sink") {
                        if (this._sinkIndexToName[evt.index]) {
                            let name = this._sinkIndexToName[evt.index];
                            delete this._sinks[name];
                            delete this._sinkIndexToName[evt.index];
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

    _getHeadphoneSink() {
        return Object.values(this._sinks).find(
            sink => sink.name === this._defaultSinkName && this._isBluetoothSink(sink)
        );
    }

    _getBuiltinSink() {
        return Object.values(this._sinks).find(
            sink => !this._isBluetoothSink(sink)
        );
    }

    _updateSinkDisplay() {
        let activeSink = Object.values(this._sinks).find(
            s => s.name === this._defaultSinkName
        );
        let headphoneSink = this._getHeadphoneSink();
        let builtinSink = this._getBuiltinSink();

        let isHeadphoneActive = !!headphoneSink && activeSink && activeSink.name === headphoneSink.name;

        // ── Header ──
        if (isHeadphoneActive) {
            this._deviceIcon.set_icon_name("audio-headphones");
            this._deviceName.set_text(headphoneSink.description || "Headset");
            this._statusBadge.show();

            let card = this._cards[headphoneSink.card];
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
            this._deviceName.set_text(builtinSink ? (builtinSink.description || "Built-in Audio") : "Speakers Built-in Audio");
            this._statusBadge.hide();
            this._deviceSubtitle.hide();
        }

        // ── Output list: speakers ──
        this._speakersNameLabel.set_text(
            builtinSink ? (builtinSink.description || "Speakers Built-in Audio") : "Speakers Built-in Audio"
        );
        if (!isHeadphoneActive) {
            this._speakersItem.set_style_class_name("output-item active");
            this._speakersCheck.set_icon_name("object-select-symbolic");
        } else {
            this._speakersItem.set_style_class_name("output-item");
            this._speakersCheck.set_icon_name("");
        }

        // ── Output list: headphone ──
        if (headphoneSink) {
            this._btNameLabel.set_text(headphoneSink.description || "Headset");

            let card = this._cards[headphoneSink.card];
            let profileDesc = card && card.active_profile && card.active_profile.description;
            if (profileDesc && profileDesc.indexOf("High Fidelity Playback") !== -1) {
                this._btMetaLabel.set_text("High quality audio");
            } else if (profileDesc && profileDesc.indexOf("Headset Head Unit") !== -1) {
                this._btMetaLabel.set_text("Microphone enabled");
            } else {
                this._btMetaLabel.set_text(profileDesc || "");
            }

            if (isHeadphoneActive) {
                this._btItem.set_style_class_name("output-item bt-item active");
                this._btCheck.set_icon_name("object-select-symbolic");

                // Show profile toggle when headphone is the active sink
                this._profileToggleWrap.show();

                // Highlight the active profile button
                if (card && card.active_profile) {
                    if (card.active_profile.name === HIGH_QUALITY_PROFILE) {
                        this._hqBtn.set_style_class_name("profile-btn hq active");
                        this._hqBtn.set_data("profile", "hq");
                        this._micBtn.set_style_class_name("profile-btn mic");
                        this._micBtn.set_data("profile", "");
                    } else if (card.active_profile.name === HEADSET_PROFILE) {
                        this._micBtn.set_style_class_name("profile-btn mic active");
                        this._micBtn.set_data("profile", "mic");
                        this._hqBtn.set_style_class_name("profile-btn hq");
                        this._hqBtn.set_data("profile", "");
                    }
                }
            } else {
                this._btItem.set_style_class_name("output-item bt-item");
                this._btCheck.set_icon_name("");
                this._profileToggleWrap.hide();
            }

            this._btItem.show();
        } else {
            this._btItem.hide();
        }
    }

    _updateProfileDisplay() {
        // Profile state is now handled inside _updateSinkDisplay
        // This updates the switch profile button state (legacy)
        // We leave the handler for card profile event processing
    }

    _updateAvailableDevices() {
        // Find Bluetooth cards that don't have a corresponding sink
        let btCards = {};
        for (let idx in this._cards) {
            let card = this._cards[idx];
            if (card.properties && card.properties["device.bus"] === "bluetooth") {
                btCards[idx] = card;
            }
        }

        // Remove cards that already have a sink
        for (let sink of Object.values(this._sinks)) {
            delete btCards[sink.card];
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
    }

    _selectSink(type) {
        if (type === "headphones") {
            let headphoneSink = this._getHeadphoneSink();
            if (headphoneSink) {
                GLib.spawn_command_line_async(
                    "pactl set-default-sink " + headphoneSink.name
                );
            }
        } else if (type === "speakers") {
            let builtinSink = this._getBuiltinSink();
            if (builtinSink) {
                GLib.spawn_command_line_async(
                    "pactl set-default-sink " + builtinSink.name
                );
            }
        }
    }

    _onSetProfile(profile) {
        let headphoneSink = this._getHeadphoneSink();
        if (!headphoneSink) return;

        let card = this._cards[headphoneSink.card];
        if (!card) return;

        if (profile === "hq") {
            GLib.spawn_command_line_async(
                "pactl set-card-profile " + card.name + " " + HIGH_QUALITY_PROFILE
            );
        } else if (profile === "mic") {
            GLib.spawn_command_line_async(
                "pactl set-card-profile " + card.name + " " + HEADSET_PROFILE
            );
        }
    }

    _onDisconnect() {
        let headphoneSink = this._getHeadphoneSink();
        if (!headphoneSink) return;

        let card = this._cards[headphoneSink.card];
        if (!card) return;

        // Set profile to "off" to disconnect the Bluetooth device
        GLib.spawn_command_line_async(
            "pactl set-card-profile " + card.name + " off"
        );
    }

    _onConnectDevice(cardIdx) {
        let card = this._cards[cardIdx];
        if (!card) return;

        // Try setting a profile to connect; a2dp-sink is typical for audio
        GLib.spawn_command_line_async(
            "pactl set-card-profile " + card.name + " " + HIGH_QUALITY_PROFILE
        );
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