/*:
 * @target MZ
 * @plugindesc 五頁套裝：同步武器、裝備與道具快捷欄，沿用原生整套換裝結算。
 * @help
 * 放在 StandaloneEquipScene 與 StandaloneItemScene 之後。
 * 背包上方點「套裝1～5」切頁；第一次點空頁會複製目前配置。
 * 每頁修改自動記住，隨正常存檔保存；也可點「儲存此套」。
 * Shift＋點任一分頁，以目前配置覆寫該頁（可重建缺件頁）。
 * 切頁預覽在離開背包後結算，不複製物品，不改耐久。
 * 配裝缺件或欄位鎖定時整套拒絕套用，不會部分換裝。
 * 地圖按數字鍵1～5（亦支援數字小鍵盤）立即換裝；背包內按相同鍵切頁。
 * 地圖快捷鍵只套用已設定頁面，對話、傳送及死亡期間不接受切換。
 */
(() => {
    'use strict';
    const PAGE_COUNT = 5;
    const STORE_KEY = '_localLoadoutPages';
    let pendingHotkey = null;
    const baseId = item => item?.baseItemId || item?.id || 0;
    const fists = item => !!item && DataManager.isWeapon(item) && baseId(item) === 4;
    const clone = value => JSON.parse(JSON.stringify(value));

    function store(actor) {
        let data = actor[STORE_KEY];
        if (!data || data.version !== 1) {
            data = actor[STORE_KEY] = { version: 1, active: 0, pages: Array(PAGE_COUNT).fill(null) };
        }
        data.active = Math.max(0, Math.min(PAGE_COUNT - 1, Number(data.active) || 0));
        return data;
    }
    function reference(item) {
        if (!item) return null;
        if (fists(item)) return { kind: 'fists' };
        const independent = DataManager.isIndependent(item);
        if (independent && !item._localLoadoutToken) {
            item._localLoadoutToken = Date.now().toString(36) + '-' + Math.random().toString(36).slice(2);
        }
        return { kind: DataManager.isWeapon(item) ? 'weapon' : 'armor', id: item.id,
            baseId: baseId(item), token: independent ? item._localLoadoutToken : null };
    }
    function resolve(ref) {
        if (!ref || ref.kind === 'fists') return null;
        const item = (ref.kind === 'weapon' ? $dataWeapons : $dataArmors)[ref.id];
        return item && baseId(item) === ref.baseId && (!ref.token || item._localLoadoutToken === ref.token) ? item : null;
    }
    function currentQuick() {
        const saved = $gameSystem._standaloneQuickItems;
        const ids = Array.isArray(saved) ? saved : StandaloneItemScene.quickItemIds();
        return Array.from({ length: 7 }, (_, i) => Number(ids[i]) || 0);
    }
    function snapshot(planner) {
        const current = $gameSystem._uiSlotData?.['R Key'];
        return { equips: planner._actor.equips().map(reference), quick: currentQuick(),
            selectedItem: current?.type === 'item' ? current.id : 0 };
    }
    function savePage(scene) {
        const planner = scene._loadoutPlanner;
        const data = store(planner._session.actor);
        data.pages[data.active] = snapshot(planner);
    }
    function actualSnapshot(actor) {
        return snapshot({ _actor: actor });
    }
    function installQuick(page) {
        const seen = new Set();
        $gameSystem._standaloneQuickItems = Array.from({ length: 7 }, (_, i) => {
            const id = page.quick?.[i] || 0;
            const item = $dataItems[id];
            if (!item?.note?.includes('<useableItem>') || seen.has(id)) return 0;
            seen.add(id);
            return id;
        });
        const selected = page.selectedItem;
        if (selected && $gameSystem._standaloneQuickItems.includes(selected) && $gameParty.numItems($dataItems[selected]) > 0) {
            $gameSystem._uiSlotData ||= {};
            $gameSystem._uiSlotData['R Key'] = { type: 'item', id: selected };
        }
        StandaloneItemScene.syncQuickItems();
    }
    function planPage(planner, page) {
        const slots = planner.equipmentSlots();
        if (!Array.isArray(page.equips) || page.equips.length !== slots.length) {
            throw new Error('這頁的裝備欄數量已改變，請重新儲存。');
        }
        const before = planner._actor.equips();
        const next = page.equips.map((ref, slot) => {
            if (!ref) return slot === 0 ? planner.previewFists() : null;
            if (ref.kind === 'fists') return planner.previewFists();
            const item = resolve(ref);
            if (!item) throw new Error('這頁有裝備已損壞或移除，請先重新配置。');
            return item;
        });
        const counts = new Map();
        next.forEach((item, slot) => {
            if (item !== before[slot] && !planner.isSlotUnlocked(slot)) {
                throw new Error('有裝備欄被鎖定，無法切換這套配置。');
            }
            if (!item) return;
            if (item.etypeId !== slots[slot] || (!fists(item) && !planner._actor.canEquip(item))) {
                throw new Error('這頁含有目前無法裝備的物品。');
            }
            if (fists(item)) return;
            counts.set(item, (counts.get(item) || 0) + 1);
        });
        for (const [item, count] of counts) {
            const available = (planner._session.total.get(item) || 0) - planner._session.drops.filter(x => x === item).length;
            if (available < count) throw new Error('缺少「' + item.name + '」，未切換任何裝備。');
        }
        return next;
    }
    function switchPage(scene, index) {
        const planner = scene._loadoutPlanner;
        const data = store(planner._session.actor);
        if (!Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) return false;
        if (index === data.active) return true;
        const existing = data.pages[index];
        let next;
        try { if (existing) next = planPage(planner, existing); }
        catch (error) {
            message(scene, error.message, true);
            SoundManager.playBuzzer();
            return false;
        }
        savePage(scene);
        if (!existing) data.pages[index] = clone(data.pages[data.active]);
        data.active = index;
        if (next) {
            planner._actor._equips = next.map(item => new Game_Item(item));
            planner._inventoryRevision++;
            installQuick(existing);
        }
        if (scene === planner) scene.refreshEquipment(true);
        else scene.refreshQuickPanel();
        message(scene, existing ? '已選套裝' + (index + 1) + '；離開背包後套用武器與裝備。' :
            '已複製到套裝' + (index + 1) + '；現在可調整這頁配置。');
        drawBar(scene);
        SoundManager.playEquip();
        return true;
    }
    function copyToPage(scene, index) {
        if (!Number.isInteger(index) || index < 0 || index >= PAGE_COUNT) return false;
        const data = store(scene._loadoutPlanner._session.actor);
        savePage(scene);
        data.pages[index] = clone(data.pages[data.active]);
        data.active = index;
        drawBar(scene);
        message(scene, '已用目前配置覆寫套裝' + (index + 1) + '；可繼續調整。');
        SoundManager.playSave();
        return true;
    }
    function message(scene, text, error = false) {
        const bitmap = scene._loadoutMessage.bitmap;
        bitmap.clear();
        bitmap.fontFace = $gameSystem.mainFontFace();
        bitmap.fontSize = 17;
        bitmap.textColor = error ? '#ffaaaa' : '#e5dbbd';
        bitmap.outlineWidth = 3;
        bitmap.outlineColor = '#181511';
        bitmap.drawText(text, 0, 0, bitmap.width, bitmap.height, 'center');
    }
    function drawBar(scene) {
        const data = store(scene._loadoutPlanner._session.actor);
        const bitmap = scene._loadoutBar.bitmap;
        bitmap.clear();
        bitmap.fontFace = $gameSystem.mainFontFace();
        bitmap.fontSize = 22;
        bitmap.outlineWidth = 2;
        bitmap.outlineColor = '#171512';
        for (let i = 0; i < PAGE_COUNT; i++) {
            const x = i * 108;
            const active = data.active === i;
            bitmap.fillRect(x, 0, 100, 42, active ? '#c6a251' : 'rgba(28,30,24,0.95)');
            bitmap.fillRect(x + 2, 2, 96, 38, active ? '#61502d' : '#30382c');
            bitmap.textColor = active ? '#fff0b6' : data.pages[i] ? '#dddcca' : '#a3ab9b';
            bitmap.drawText('套裝' + (i + 1), x, 0, 100, 42, 'center');
        }
        bitmap.fillRect(548, 0, 140, 42, '#34453d');
        bitmap.textColor = '#e5f0df';
        bitmap.drawText('儲存此套', 548, 0, 140, 42, 'center');
    }
    function createBar(scene, equipment) {
        let planner = scene;
        if (!equipment) {
            planner = new Scene_StandaloneEquip();
            planner._actor = $gameParty.leader();
            planner.beginEquipSession();
        }
        scene._loadoutPlanner = planner;
        const data = store(planner._session.actor);
        data.pages[data.active] = snapshot(planner);
        const x = Math.round((Graphics.width - 1234) / 2) + 36;
        scene._loadoutBar = new Sprite(new Bitmap(692, 42));
        scene._loadoutBar.move(x, 105);
        scene.addChild(scene._loadoutBar);
        scene._loadoutMessage = new Sprite(new Bitmap(706, 32));
        scene._loadoutMessage.move(x - 6, 151);
        scene.addChild(scene._loadoutMessage);
        drawBar(scene);
        message(scene, '數字1～5切套裝｜Shift＋點頁覆寫｜地圖亦可按數字立即換裝');
    }
    function clearPointer() {
        TouchInput.clear();
        for (const button of ['left', 'right', 'middle']) {
            const prefix = '_drill_COI_' + button;
            if (prefix + 'Pressed' in TouchInput) TouchInput[prefix + 'Pressed'] = false;
            for (const suffix of ['PressedTime', 'ReleasedTime', 'DoubledTime']) {
                if (prefix + suffix in TouchInput) TouchInput[prefix + suffix] = undefined;
            }
        }
    }
    function barOwnsPointer(scene) {
        const bar = scene._loadoutBar;
        if (!bar || scene._closing || scene._gesture) return false;
        const x = TouchInput.x - bar.x, y = TouchInput.y - bar.y;
        if (x < 0 || x >= 692 || y < 0 || y >= 42) return false;
        if (scene.actionActive() || scene._equipStackPicker?.visible) return true;
        if (TouchInput.isTriggered() || TouchInput.drill_isLeftTriggerd?.()) {
            if (x < 540 && x % 108 < 100) {
                const index = Math.floor(x / 108);
                if (Input.isPressed('shift')) copyToPage(scene, index);
                else switchPage(scene, index);
            }
            else if (x >= 548 && x < 688) {
                savePage(scene);
                drawBar(scene);
                message(scene, '已記住這套配置；正常存檔後保留五頁設定。');
                SoundManager.playSave();
            }
            clearPointer();
        }
        return true;
    }
    function disposeBar(scene) {
        for (const key of ['_loadoutBar', '_loadoutMessage']) {
            const sprite = scene[key];
            if (!sprite) continue;
            scene[key] = null;
            sprite.parent?.removeChild(sprite);
            const bitmap = sprite.bitmap;
            sprite.bitmap = null;
            bitmap?.destroy();
            sprite.destroy();
        }
    }
    function hookScene(Type, equipment) {
        const proto = Type.prototype;
        const start = proto.start;
        proto.start = function() {
            start.apply(this, arguments);
            if (!this._loadoutBar) createBar(this, equipment);
        };
        const pointer = proto.updatePointer;
        proto.updatePointer = function() {
            if (!barOwnsPointer(this)) return pointer.apply(this, arguments);
        };
        const destroy = proto.destroy;
        proto.destroy = function() {
            const actor = this._loadoutPlanner?._session?.actor;
            const closing = this._closing;
            disposeBar(this);
            try {
                if (equipment) {
                    // 原場景在返回地圖且精靈就緒後，才執行原生結算。
                    return destroy.apply(this, arguments);
                }
                // 道具場景的武器／裝備預覽也沿用同一結算器。
                if (this._closing && this._loadoutPlanner) {
                    this._loadoutPlanner.commitEquipSession();
                }
                return destroy.apply(this, arguments);
            } finally {
                if (closing && actor) {
                    const data = store(actor);
                    data.pages[data.active] = actualSnapshot(actor);
                }
            }
        };
    }
    hookScene(Scene_StandaloneEquip, true);
    hookScene(Scene_StandaloneItem, false);

    function mapInputAllowed(scene) {
        return scene instanceof Scene_Map && scene.isActive() && !scene.isBusy() &&
            scene._mapLoaded && scene._spriteset && !SceneManager.isSceneChanging() &&
            $gameParty.leader()?.hp > 0 && !$gameMessage.isBusy() && !$gameMap.isEventRunning() &&
            !$gamePlayer.isTransferring() && !$gameTemp._eventReserved && !$gameSwitches.value(14) &&
            $gamePlayer._drill_EASA_enabled !== false &&
            !QJ.MPMZ.tl.ex_isPlayerDeathInputBlocked?.() &&
            (!scene._MapSelectEquipWindow || scene._MapSelectEquipWindow.isClosed());
    }
    function bagInputAllowed(scene) {
        return (scene instanceof Scene_StandaloneEquip || scene instanceof Scene_StandaloneItem) &&
            scene.isActive() && !SceneManager.isSceneChanging() && scene._loadoutPlanner &&
            !scene._closing && !scene._gesture && !scene.actionActive() &&
            !scene._equipStackPicker?.visible;
    }
    function mapMessage(scene, text, error = false) {
        let sprite = scene._localLoadoutToast;
        if (!sprite) {
            sprite = scene._localLoadoutToast = new Sprite(new Bitmap(760, 44));
            scene.addChild(sprite);
        }
        sprite.x = Math.round((Graphics.width - 760) / 2);
        sprite.y = Graphics.height - 158;
        const bitmap = sprite.bitmap;
        bitmap.clear();
        bitmap.fontFace = $gameSystem.mainFontFace();
        bitmap.fontSize = 21;
        bitmap.outlineWidth = 3;
        bitmap.textColor = error ? '#ffb2a6' : '#ffe7a3';
        bitmap.fillRect(0, 0, 760, 44, 'rgba(22,27,22,0.88)');
        bitmap.drawText(text, 12, 0, 736, 44, 'center');
        sprite._expires = performance.now() + 2600;
        sprite.visible = true;
    }
    function switchOnMap(scene, index) {
        if (!Number.isInteger(index) || index < 0 || index >= PAGE_COUNT || !mapInputAllowed(scene)) return false;
        const actor = $gameParty.leader();
        const data = store(actor);
        const page = data.pages[index];
        if (!page) {
            mapMessage(scene, '套裝' + (index + 1) + '尚未設定，請先到背包配置並儲存。', true);
            SoundManager.playBuzzer();
            return false;
        }
        if (index === data.active) {
            mapMessage(scene, '目前已使用套裝' + (index + 1));
            return true;
        }
        const planner = new Scene_StandaloneEquip();
        planner._actor = actor;
        try {
            planner.beginEquipSession();
            const next = planPage(planner, page);
            const previous = actualSnapshot(actor);
            planner._actor._equips = next.map(item => new Game_Item(item));
            // 同一個地圖更新邊界內執行原生整套結算；不逐欄呼叫 changeEquip。
            planner.commitEquipSession();
            installQuick(page);
            data.pages[data.active] = previous;
            data.active = index;
            data.pages[index] = actualSnapshot(actor);
            mapMessage(scene, '已切換套裝' + (index + 1) + '（武器・裝備・道具）');
            SoundManager.playEquip();
            return true;
        } catch (error) {
            const committed = planner._session?.consumed;
            mapMessage(scene, committed ? '換裝結算失敗，請開啟背包檢查配置。' : error.message, true);
            if (committed) console.error('[LocalLoadoutPages]', error);
            SoundManager.playBuzzer();
            return false;
        } finally {
            // 只建立了原生結算器，沒有建立背包視窗或貼圖。
            planner._session = null;
            planner._actor = null;
            Scene_Base.prototype.destroy.call(planner, { children: true });
        }
    }
    function processHotkey(scene) {
        const request = pendingHotkey;
        if (!request) return;
        pendingHotkey = null;
        if (request.scene !== scene || request.actor !== $gameParty.leader()) return;
        if (scene instanceof Scene_Map) switchOnMap(scene, request.index);
        else if (bagInputAllowed(scene)) switchPage(scene, request.index);
    }
    document.addEventListener('keydown', event => {
        if (event.repeat || event.isComposing || event.ctrlKey || event.altKey || event.metaKey || event.shiftKey) return;
        if (/^(INPUT|TEXTAREA|SELECT)$/.test(event.target?.tagName || '') || event.target?.isContentEditable) return;
        const match = /^(?:Digit|Numpad)([1-5])$/.exec(event.code);
        if (!match || !/^[1-5]$/.test(event.key)) return;
        const scene = SceneManager._scene;
        if (!mapInputAllowed(scene) && !bagInputAllowed(scene)) return;
        event.preventDefault();
        pendingHotkey = { scene, actor: $gameParty.leader(), index: Number(match[1]) - 1 };
    });
    for (const Type of [Scene_Map, Scene_StandaloneEquip, Scene_StandaloneItem]) {
        const update = Type.prototype.update;
        Type.prototype.update = function() {
            processHotkey(this);
            const result = update.apply(this, arguments);
            if (this._localLoadoutToast) {
                this._localLoadoutToast.visible = performance.now() < this._localLoadoutToast._expires && mapInputAllowed(this);
            }
            return result;
        };
    }
    const destroyMap = Scene_Map.prototype.destroy;
    Scene_Map.prototype.destroy = function() {
        const sprite = this._localLoadoutToast;
        this._localLoadoutToast = null;
        if (sprite) {
            sprite.parent?.removeChild(sprite);
            const bitmap = sprite.bitmap;
            sprite.bitmap = null;
            bitmap?.destroy();
            sprite.destroy();
        }
        if (pendingHotkey?.scene === this) pendingHotkey = null;
        return destroyMap.apply(this, arguments);
    };
    window.LocalLoadoutPages = Object.freeze({ version: '1.1.0', switchPage, switchOnMap, savePage, copyToPage,
        inspect: actor => clone(store(actor || $gameParty.leader())) });
})();
