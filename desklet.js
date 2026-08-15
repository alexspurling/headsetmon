const St = imports.gi.St;
const Clutter = imports.gi.Clutter;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Desklet = imports.ui.desklet;

const UUID = "headsetmon@bytepath";

class DeskClock extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this._timeoutId = 0;
        this._entityInfo = {};
        this._sinks = {};
        this._defaultSinkName = null;
        this._sinkIndexToName = {};
        this._cards = {};

        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "headsetmon-container"
        });

        let sinkIcon = new St.Icon({ icon_name: "audio-headphones", icon_size: 22 });
        let sinkIconBox = new St.Widget({
            style_class: "headsetmon-sink-icon",
            layout_manager: new Clutter.BinLayout()
        });
        sinkIconBox.add_actor(sinkIcon);

        this._bluetoothDot = new St.Widget({
            style_class: "headsetmon-bluetooth-dot",
            x_align: Clutter.ActorAlign.END,
            y_align: Clutter.ActorAlign.END
        });
        sinkIconBox.add_actor(this._bluetoothDot);
        this._bluetoothDot.hide();
        this._sinkLabel = new St.Label({ style_class: "headsetmon-device" });
        this._sinkLabel.clutter_text.line_wrap = true;
        this._sinkLabel.clutter_text.line_wrap_mode = 2; // wrap at word boundaries (or characters if words are too long)
        this._sinkLabel.clutter_text.ellipsize = 0; // Important to disable ellipses because they override any wrapping
        let sinkRow = new St.BoxLayout({ style_class: "headsetmon-sink-row" });
        sinkRow.add(sinkIconBox, { x_fill: false, y_fill: false, x_align: St.Align.START, y_align: St.Align.MIDDLE });
        sinkRow.add(this._sinkLabel, { x_fill: true, y_fill: false, x_align: St.Align.MIDDLE, y_align: St.Align.MIDDLE });
        this._container.add(sinkRow, { x_fill: true, x_align: St.Align.MIDDLE });

        let separator = new St.BoxLayout({ style_class: "headsetmon-separator" });
        this._container.add(separator, { x_fill: true, y_fill: false, x_align: St.Align.MIDDLE });

        let spacer = new St.Bin();
        spacer.y_expand = true;
        this._container.add(spacer, { x_fill: true, x_align: St.Align.FILL });

        let profileRow = new St.BoxLayout({ style_class: "headsetmon-profile-row" });
        profileRow.add(new St.Label({ text: "Current profile: ", style_class: "headsetmon-profile-label" }), { x_fill: false, x_align: St.Align.START });
        this._profileLabel = new St.Label({ style_class: "headsetmon-profile-text" });
        this._profileLabel.clutter_text.line_wrap = true;
        this._profileLabel.clutter_text.line_wrap_mode = 2; // wrap at word boundaries (or characters if words are too long)
        this._profileLabel.clutter_text.ellipsize = 0; // Important to disable ellipses because they override any wrapping
        profileRow.add(this._profileLabel, { x_fill: true, x_align: St.Align.START });
        this._container.add(profileRow, { x_fill: true, x_align: St.Align.MIDDLE });

        this._switchProfileButton = new St.Button({ label: "Switch profile", style_class: "headsetmon-switch-button" });
        this._container.add(this._switchProfileButton, { x_fill: true, x_align: St.Align.MIDDLE });

        // Load the desklet's own stylesheet
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
        console.log("Calling PulseAudio monitor");
        try {
            this._pulseAudioProcess = new Gio.Subprocess({
                argv: ["/home/alex/dev/cpp/paeventmon/cmake-build-debug/paeventmon"],
                flags: Gio.SubprocessFlags.STDOUT_PIPE
            });

            console.log("Calling init");
            this._pulseAudioProcess.init(null);

            console.log("Getting stdout pipe");
            let stdout = this._pulseAudioProcess.get_stdout_pipe();

            console.log("Creating data input stream");
            this._pulseAudioStream = new Gio.DataInputStream({
                base_stream: stdout
            });

            console.log("Reading pulseAudio stream");
            this._readPulseAudioEvent();
        } catch (e) {
            console.error("Error calling pulseAudio:", e);
        }
    }

    _readPulseAudioEvent() {
        this._pulseAudioStream.read_line_async(
            GLib.PRIORITY_DEFAULT,
            null,
            (stream, result) => {
                try {
                    let [line] = stream.read_line_finish_utf8(result);

                    if (line === null) {
                        // pulseAudio exited
                        console.log("Waiting for events from PulseAudioEventMon");
                        return;
                    }

                    let evt;
                    try {
                        evt = JSON.parse(line);
                    } catch (_) {
                        // skip non-JSON lines (stderr noise, etc.)
                        this._readPulseAudioEvent();
                        return;
                    }

                    let on = evt.on;
                    let event = evt.event;

                    console.log(JSON.stringify(evt));

                    if (event === "new" || event === "change") {
                        if (on === "sink" && evt.name && evt.card && evt.description) {
                            this._sinks[evt.index] = { name: evt.name, card: evt.card, description: evt.description }
                            this._updateSinkDisplay();
                        } else if (on === "sink" && event === "change" && evt.prop === "description") {
                            if (this._sinks[evt.index]) {
                                this._sinks[evt.index].description = evt.new;
                                this._updateSinkDisplay();
                            }
                        } else if (on === "server" && evt.default_sink_name) {
                            this._defaultSinkName = evt.default_sink_name;
                            this._updateSinkDisplay();
                            this._updateProfileDisplay();
                        } else if (on === "server" && event === "change" && evt.prop === "default_sink_name") {
                            console.log("default sink changed to " + evt.new);
                            this._defaultSinkName = evt.new;
                            this._updateSinkDisplay();
                            this._updateProfileDisplay();
                        } else if (on === "card" && event === "new" && evt.active_profile && evt.active_profile.description && evt.proplist) {
                            console.log("Card event is", JSON.stringify(evt));
                            this._cards[evt.index] = {
                                name: evt.name,
                                active_profile: { name: evt.active_profile.name, description: evt.active_profile.description },
                                proplist: evt.proplist
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
                            this._updateSinkDisplay();
                        }
                    }

                    // Wait for the next event
                    this._readPulseAudioEvent();

                } catch (e) {
                    console.error("Error reading pulseAudio:", e);
                }
            }
        );
    }

    _updateSinkDisplay() {
        let sinkWithName = Object.values(this._sinks).find(sink => sink.name === this._defaultSinkName);
        if (sinkWithName) {
            let card = this._cards[sinkWithName.card];
            if (card.proplist && card.proplist["device.bus"] === "bluetooth") {
                this._bluetoothDot.show();
            } else {
                this._bluetoothDot.hide();
            }
            this._sinkLabel.set_text(sinkWithName.description || "Unknown");
        } else {
            this._bluetoothDot.hide();
        }
    }

    _updateProfileDisplay() {
        let sinkWithName = Object.values(this._sinks).find(sink => sink.name === this._defaultSinkName);
        if (sinkWithName) {
            let card = this._cards[sinkWithName.card];
            let desc = card?.active_profile?.description;
            if (desc && desc.startsWith("High Fidelity Playback")) {
                this._profileLabel.style_class = "headsetmon-profile-text headsetmon-profile-quality";
                this._profileLabel.set_text("High quality audio");
            } else if (desc && desc.startsWith("Headset Head Unit")) {
                this._profileLabel.style_class = "headsetmon-profile-text headsetmon-profile-mic";
                this._profileLabel.set_text("Microphone enabled");
            } else {
                this._profileLabel.style_class = "headsetmon-profile-text";
                this._profileLabel.set_text(desc || "Unknown");
            }
        }
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
