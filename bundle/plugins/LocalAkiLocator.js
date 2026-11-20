/*:
 * @target MZ
 * @plugindesc Aki 尋人提示：F6／點擊面板查看方向、距離、出攤區域與條件。
 * @help
 * 地圖右上角點「尋找 Aki」或按 F6 展開／收合。
 * 同圖出攤時顯示方向、直線距離與座標，並在 Aki 頭上加上標記。
 * 保留原生隨機出攤、天氣與每日刷新規則，不生成商店、不傳送玩家。
 */
(() => {
    'use strict';
    let expanded = false;
    let toggleRequested = false;
    const candidates = {
        10: '冒險遊步道・深淵之門', 13: '遺跡之森・入口', 16: '遺跡之森・第 2 區',
        18: '冒險遊步道・入口', 26: '遺跡之森・第 3 區', 27: '遺跡之森・第 4 區',
        47: '遺跡之森・第 5 區', 48: '冒險遊步道・第 4 區',
        49: '冒險遊步道・第 2 區', 58: '冒險遊步道・第 3 區'
    };
    function playable(scene) {
        return scene instanceof Scene_Map && scene.isActive() && !scene.isBusy() &&
            !$gameMessage.isBusy() && !$gameMap.isEventRunning();
    }
    function isAki(event) {
        return !!event && !event._erased && event._sourceeventId === 97;
    }
    function nearestAki() {
        let nearest = null, distance = Infinity;
        for (const event of $gameMap.events()) {
            if (!isAki(event)) continue;
            const dx = $gameMap.deltaX(event._realX, $gamePlayer._realX);
            const dy = $gameMap.deltaY(event._realY, $gamePlayer._realY);
            const value = Math.hypot(dx, dy);
            if (value < distance) { nearest = { event, dx, dy, distance: value }; distance = value; }
        }
        return nearest;
    }
    function direction(dx, dy) {
        if (Math.hypot(dx, dy) < 2) return '就在身旁';
        const h = Math.abs(dx) > Math.abs(dy) * 0.45 ? (dx > 0 ? '東' : '西') : '';
        const v = Math.abs(dy) > Math.abs(dx) * 0.45 ? (dy > 0 ? '南' : '北') : '';
        const arrows = { 東: '→', 西: '←', 南: '↓', 北: '↑', 東南: '↘', 西南: '↙', 東北: '↗', 西北: '↖' };
        return `${arrows[h + v]} ${h + v}方`;
    }
    function linesFor(target) {
        if (target) {
            return [
                '尋找 Aki  ·  F6 收合',
                'Aki 正在這張地圖出攤！',
                `${direction(target.dx, target.dy)}  ·  直線約 ${Math.ceil(target.distance)} 格`,
                `位置：${target.event.x.toFixed(1)}, ${target.event.y.toFixed(1)}`,
                '靠近頭頂「▼ Aki」的店員互動。',
                '帶觸手與鮭魚，可交換特殊商品。'
            ];
        }
        const area = candidates[$gameMap.mapId()];
        const rain = $gameVariables.value(60) === 2;
        const pending = $gameSelfSwitches.value([1, 94, 'D']);
        return [
            '尋找 Aki  ·  F6 收合',
            '目前這張地圖尚未找到 Aki。',
            area ? `這裡可出攤：${area}` : '這裡沒有原生出攤位置。',
            rain ? '目前下雨，原生出攤檢查暫停。' : pending ? '仍有出攤機會，可切換區域尋找。' : '本輪出攤機會已用過，可等隔天。',
            '尋找區域：冒險遊步道、遺跡之森',
            '遊步道：入口、深淵之門、第 2～4 區',
            '遺跡之森：入口、第 2～5 區',
            '晴／陰天切換區域；仍依原生機率。'
        ];
    }
    document.addEventListener('keydown', event => {
        if (event.code === 'F6' && !event.repeat && !event.isComposing && playable(SceneManager._scene)) {
            event.preventDefault();
            toggleRequested = true;
        }
    });
    class AkiPanel extends Sprite {
        constructor() {
            super(new Bitmap(420, 272));
            this._ticks = 0;
            this._signature = '';
            this._height = 36;
        }
        hit() {
            return this.visible && TouchInput.x >= this.x && TouchInput.x < this.x + 420 &&
                TouchInput.y >= this.y && TouchInput.y < this.y + this._height;
        }
        update() {
            super.update();
            const scene = SceneManager._scene;
            this.visible = playable(scene);
            this.x = Math.max(0, Graphics.width - 432);
            this.y = 90;
            if (!this.visible) { toggleRequested = false; return; }
            if (toggleRequested || (TouchInput.isTriggered() && this.hit())) {
                expanded = !expanded;
                toggleRequested = false;
                this._ticks = 0;
            }
            if (this._ticks-- > 0) return;
            this._ticks = 29;
            const target = nearestAki();
            const lines = expanded ? linesFor(target) : [`${target ? '★ Aki 就在這張地圖' : '尋找 Aki'}  ·  F6／點擊展開`];
            const signature = JSON.stringify(lines);
            if (signature === this._signature) return;
            this._signature = signature;
            this._height = lines.length * 32 + 12;
            const bitmap = this.bitmap;
            bitmap.clear();
            bitmap.fontFace = $gameSystem.mainFontFace();
            bitmap.fontSize = 19;
            bitmap.outlineWidth = 3;
            bitmap.fillRect(0, 0, 420, this._height, 'rgba(16,24,20,0.88)');
            lines.forEach((line, i) => {
                bitmap.textColor = i === 0 ? '#ffe58c' : i === 1 && target ? '#9dffb0' : '#ffffff';
                bitmap.drawText(line, 12, 6 + i * 32, 396, 32, 'left');
            });
        }
        destroy() {
            const bitmap = this.bitmap;
            super.destroy();
            bitmap.destroy();
        }
    }
    const create = Scene_Map.prototype.createDisplayObjects;
    Scene_Map.prototype.createDisplayObjects = function() {
        create.apply(this, arguments);
        this._localAkiPanel = new AkiPanel();
        this.addChild(this._localAkiPanel);
    };
    const touchOk = Scene_Map.prototype.isMapTouchOk;
    Scene_Map.prototype.isMapTouchOk = function() {
        return !this._localAkiPanel?.hit() && touchOk.apply(this, arguments);
    };
    const updateCharacter = Sprite_Character.prototype.update;
    Sprite_Character.prototype.update = function() {
        updateCharacter.apply(this, arguments);
        const active = isAki(this._character) && playable(SceneManager._scene) && this.visible;
        if (!active) { if (this._localAkiLabel) this._localAkiLabel.visible = false; return; }
        if (!this._localAkiLabel) {
            const bitmap = new Bitmap(130, 36);
            bitmap.fontFace = $gameSystem.mainFontFace();
            bitmap.fontSize = 24;
            bitmap.textColor = '#ffe58c';
            bitmap.outlineColor = '#172218';
            bitmap.outlineWidth = 5;
            bitmap.drawText('▼ Aki', 0, 0, 130, 36, 'center');
            const label = this._localAkiLabel = new Sprite(bitmap);
            label.anchor.set(0.5, 1);
            // 招牌與屋頂會蓋住店員，標記放到整個攤位上方。
            label.y = -250;
            this.addChild(label);
        }
        this._localAkiLabel.visible = true;
        const label = this._localAkiLabel;
        label.y = -250;
        const top = label.getBounds().y;
        const scale = label.worldTransform.d;
        if (top < 8 && scale > 0) label.y += (8 - top) / scale;
    };
    const destroyCharacter = Sprite_Character.prototype.destroy;
    Sprite_Character.prototype.destroy = function() {
        const bitmap = this._localAkiLabel?.bitmap;
        destroyCharacter.apply(this, arguments);
        bitmap?.destroy();
    };
})();
