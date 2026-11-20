/*:
 * @target MZ
 * @plugindesc 在稻草人頭上顯示最近 1 秒 DPS 與本次地圖最高單次傷害。
 */
(() => {
    "use strict";

    const windowMs = 1000;
    const measurements = new WeakMap();
    const format = new Intl.NumberFormat("zh-TW", { maximumFractionDigits: 1 });

    function isActiveScarecrow(event) {
        // 地圖 1 的事件 110 是稻草人範本；第 2 頁才可受擊。
        return event && !event._erased && event._pageIndex === 1 &&
            (event._sourceMapId ?? event._mapId) === 1 &&
            (event._sourceeventId ?? event._eventId) === 110;
    }

    function trim(measurement, now) {
        const { hits } = measurement;
        while (hits.length && hits[0].time <= now - windowMs) {
            measurement.total -= hits.shift().damage;
        }
    }

    const setValue = Game_SelfVariables.prototype.setValue;
    Game_SelfVariables.prototype.setValue = function(key, value) {
        const event = Array.isArray(key) && key[2] === "HP" &&
            key[0] === $gameMap?.mapId() && $gameMap.event(key[1]);
        if (!isActiveScarecrow(event)) return setValue.apply(this, arguments);

        const before = this.value(key);
        const result = setValue.apply(this, arguments);
        const damage = before - Math.max(0, this.value(key));
        if (damage > 0 && Number.isFinite(damage)) {
            const now = performance.now();
            let measurement = measurements.get(event);
            if (!measurement) {
                measurement = { hits: [], total: 0, maxDamage: 0 };
                measurements.set(event, measurement);
            }
            trim(measurement, now);
            measurement.hits.push({ time: now, damage });
            measurement.total += damage;
            measurement.maxDamage = Math.max(measurement.maxDamage, damage);
        }
        return result;
    };

    const pipeline = globalThis.QJ?.MPMZ?.DP;
    if (pipeline?.on) {
        pipeline.on("after", {
            order: 900,
            name: "稻草人最高單次傷害",
            fn(context) {
                if (!isActiveScarecrow(context.target)) return;
                const measurement = measurements.get(context.target);
                if (measurement && Number.isFinite(context.dealt)) {
                    measurement.maxDamage = Math.max(measurement.maxDamage, context.dealt);
                }
            }
        });
    }

    class DpsLabel extends Sprite {
        constructor() {
            super(new Bitmap(300, 56));
            this.anchor.set(0.5, 1);
            this.y = -112;
            this.bitmap.fontFace = $gameSystem.mainFontFace();
            this.bitmap.fontSize = 18;
            this.bitmap.textColor = "#ffefb3";
        }

        showValue(dps, maxDamage) {
            if (this._lastDps === dps && this._lastMaxDamage === maxDamage) return;
            this._lastDps = dps;
            this._lastMaxDamage = maxDamage;
            this.bitmap.clear();
            this.bitmap.fillRect(0, 0, 300, 56, "rgba(20, 17, 12, 0.78)");
            this.bitmap.drawText("DPS (1 秒)  " + format.format(dps), 4, 0, 292, 28, "center");
            this.bitmap.drawText("最高單次  " + format.format(maxDamage), 4, 28, 292, 28, "center");
        }

        destroy() {
            const bitmap = this.bitmap;
            super.destroy();
            bitmap.destroy();
        }
    }

    const updateCharacter = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function() {
        updateCharacter.apply(this, arguments);
        const event = this._character;
        const active = isActiveScarecrow(event);
        let label = this._localScarecrowDpsLabel;
        if (!active || !this.visible || $gameMessage.isBusy()) {
            if (label) label.visible = false;
            if (!active && label && event) measurements.delete(event);
            return;
        }
        if (!label) {
            label = this._localScarecrowDpsLabel = new DpsLabel();
            this.addChild(label);
        }
        const measurement = measurements.get(event);
        if (measurement) trim(measurement, performance.now());
        label.showValue((measurement?.total ?? 0) / (windowMs / 1000), measurement?.maxDamage ?? 0);
        label.visible = true;
        // Keep both lines readable when the scarecrow is near the screen's top edge.
        label.y = -112;
        if (typeof label.getBounds === "function") {
            const top = label.getBounds().y;
            const scaleY = label.worldTransform.d;
            if (top < 8 && scaleY > 0) label.y += (8 - top) / scaleY;
        }
    };
})();
