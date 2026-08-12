const St = imports.gi.St;
const GLib = imports.gi.GLib;
const Gio = imports.gi.Gio;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const UUID = "headsetmon@bytepath";

class DeskClock extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this._timeoutId = 0;
        this._entityInfo = {};
        this._sinks = {};
        this._defaultSinkName = null;
        this._sinkIndexToName = {};

        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "deskclock-container"
        });
        this._timeLabel = new St.Label({ style_class: "deskclock-time" });
        this._dateLabel = new St.Label({ style_class: "deskclock-date" });
        this._sinkLabel = new St.Label({ style_class: "deskclock-sink" });
        this._container.add(this._timeLabel, { x_fill: false, x_align: St.Align.MIDDLE });
        this._container.add(this._dateLabel, { x_fill: false, x_align: St.Align.MIDDLE });
        this._container.add(this._sinkLabel, { x_fill: false, x_align: St.Align.MIDDLE });

        this.setContent(this._container);
        this.setHeader(_("Clock"));

        this.settings = new Settings.DeskletSettings(this, UUID, desklet_id);
        this.settings.bind("use-24h", "use_24h", this._onSettingsChanged);
        this.settings.bind("show-date", "show_date", this._onSettingsChanged);
        this.settings.bind("font-size", "size", this._onSettingsChanged);
        this.settings.bind("text-color", "color", this._onSettingsChanged);

        this._menu.addSettingsAction(_("Date and Time Settings"), "calendar");
    }

    on_desklet_added_to_desktop(userEnabled) {
        this._onSettingsChanged();
        this._tick();

        console.log("Calling PulseAudio monitor");
        try {
            this._pulseAudioProcess = new Gio.Subprocess({
                argv: ["/home/alex/dev/cpp/pulseaudioclient/cmake-build-debug/pamon"],
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
                        console.log("PulseAudioMon exited");
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

                    if (event === "new" || event === "change") {
                        if (on === "sink" && evt.name && evt.description) {
                            this._sinks[evt.name] = evt.description;
                            this._updateSinkDisplay();
                        } else if (on === "sink" && event === "change" && evt.prop === "description") {
                            // diffs carry index + prop + old + new, not name
                            if (this._sinkIndexToName && this._sinkIndexToName[evt.index]) {
                                let name = this._sinkIndexToName[evt.index];
                                this._sinks[name] = evt.new;
                                this._updateSinkDisplay();
                            }
                        } else if (on === "server" && evt.default_sink_name) {
                            this._defaultSinkName = evt.default_sink_name;
                            this._updateSinkDisplay();
                        } else if (on === "server" && event === "change" && evt.prop === "default_sink_name") {
                            console.log("default sink changed to " + evt.new);
                            this._defaultSinkName = evt.new;
                            this._updateSinkDisplay();
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
        let desc = null;
        console.log("Got default sink with name", this._defaultSinkName, ":", !!this._sinks[this._defaultSinkName]);
        if (this._defaultSinkName && this._sinks[this._defaultSinkName]) {
            desc = this._sinks[this._defaultSinkName];
        }
        this._sinkLabel.set_text(desc || "");
    }

    on_desklet_removed(deleteConfig) {
        if (this._pulseAudioProcess) {
            this._pulseAudioProcess.force_exit();
            this._pulseAudioProcess = null;
        }
        this._stopTicking();
        this.settings.finalize();
    }


    _onSettingsChanged() {
        this._timeLabel.style = "font-size: " + this.size + "pt;\ncolor: " + this.color;
        this._dateLabel.style = "font-size: " + Math.max(Math.round(this.size / 3), 6) +
                                "pt;\ncolor: " + this.color;
        this._sinkLabel.style = "font-size: " + Math.max(Math.round(this.size / 3), 6) +
                                "pt;\ncolor: " + this.color;
        this._dateLabel.visible = this.show_date;
        this._updateClock();
    }

    _updateClock() {
        let now = GLib.DateTime.new_now_local();

        this._timeLabel.set_text(now.format(this.use_24h ? "%H:%M:%S" : "%-l:%M:%S %p"));

        if (this.show_date)
            this._dateLabel.set_text(now.format("%A, %B %-d"));
    }

    /**
     * Updates the labels, then re-arms the timer for the start of the next
     * second so the display never drifts off the second boundary.
     */
    _tick() {
        this._updateClock();

        let elapsedMs = Math.floor((GLib.get_real_time() % 1000000) / 1000);
        let delay = 1000 - elapsedMs + 5;

        this._timeoutId = GLib.timeout_add(GLib.PRIORITY_DEFAULT, delay, () => {
            this._timeoutId = 0;
            this._tick();
            return GLib.SOURCE_REMOVE;
        });
    }

    _stopTicking() {
        if (this._timeoutId > 0) {
            GLib.source_remove(this._timeoutId);
            this._timeoutId = 0;
        }
    }
}

function main(metadata, desklet_id) {
    return new DeskClock(metadata, desklet_id);
}
