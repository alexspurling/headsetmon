const St = imports.gi.St;
const GLib = imports.gi.GLib;

const Desklet = imports.ui.desklet;
const Settings = imports.ui.settings;

const UUID = "headsetmon@bytepath";

class DeskClock extends Desklet.Desklet {
    constructor(metadata, desklet_id) {
        super(metadata, desklet_id);

        this._timeoutId = 0;

        this._container = new St.BoxLayout({
            vertical: true,
            style_class: "deskclock-container"
        });
        this._timeLabel = new St.Label({ style_class: "deskclock-time" });
        this._dateLabel = new St.Label({ style_class: "deskclock-date" });
        this._container.add(this._timeLabel, { x_fill: false, x_align: St.Align.MIDDLE });
        this._container.add(this._dateLabel, { x_fill: false, x_align: St.Align.MIDDLE });

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
    }

    on_desklet_removed(deleteConfig) {
        this._stopTicking();
        this.settings.finalize();
    }

    _onSettingsChanged() {
        this._timeLabel.style = "font-size: " + this.size + "pt;\ncolor: " + this.color;
        this._dateLabel.style = "font-size: " + Math.max(Math.round(this.size / 3), 6) +
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
