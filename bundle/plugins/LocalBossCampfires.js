/*:
 * @target MZ
 * @plugindesc 在 Boss 入口附近加入可傳送的營火，包含熔岩決戰場。
 */
(() => {
    "use strict";

    const sites = {
        48: [
            { x: 8, y: 58, tx: 9, ty: 58, d: 4, name: "米斯特汀・石碑旁" },
            { x: 34, y: 35, tx: 35, ty: 35, d: 4, name: "八腕的支配者・岸邊" },
            { x: 22, y: 19, tx: 23, ty: 19, d: 4, bossId: 41, name: "茶會速遞・湖區道路" }
        ],
        50: [
            { x: 8, y: 6, tx: 9, ty: 6, d: 4, name: "狂亂的紅獸・墓穴入口" }
        ],
        62: [{ x: 3, y: 3, tx: 4, ty: 3, d: 4, name: "箱庭的白兔・森林入口" }],
        72: [{ x: 22, y: 15, tx: 22, ty: 16, d: 2, name: "紅蓮之焰瑟拉・熔岩決戰場" }],
        73: [{ x: 10, y: 55, tx: 11, ty: 55, d: 4, bossId: 126, native: true, name: "被激活的守衛石像・營火" }]
    };
    function isUnlocked({ bossId }) {
        return !bossId || $gameSelfVariables.value([1, bossId, "KillCount"]) > 0;
    }
    function recoverLavaFire(eid) {
        const fire = $gameMap.event(eid);
        if ($gameMap.mapId() !== 72 || !fire || fire._erased || fire._sourceeventId !== 7 ||
            fire.x !== 22 || fire.y !== 15 || QJ.MPMZ.tl.ex_bonfireIsLit(eid)) return;
        const dragonActive = $gameMap._events.some(event => event && !event._erased &&
            event._sourceeventId === 124 && !event._dragonDeathFinished);
        if (!dragonActive) QJ.MPMZ.tl.ex_bonfireSetLit(eid, true);
    }
    function removeRetiredCampfires() {
        for (const { mapId, x, y } of [{ mapId: 18, x: 27, y: 12 }, { mapId: 50, x: 5, y: 7 }]) {
            delete $gameSystem._bonfireWarps?.[`${mapId}:${x},${y}`];
            const isRetiredFire = data => Array.isArray(data) && data[0] === 1 && data[1] === 7 &&
                data[2] === x && data[3] === y;
            const saved = $gameSystem._spawnEventSaveDataListQJ?.[mapId];
            for (const id of Object.keys(saved || {})) {
                if (isRetiredFire(saved[id])) delete saved[id];
            }
            if ($gameMap.mapId() !== mapId) continue;
            const backup = $gameMap._backUpSpawnEventDataQJ;
            for (const id of Object.keys(backup || {})) {
                if (isRetiredFire(backup[id])) delete backup[id];
            }
            for (const event of $gameMap._events.slice()) {
                if (event && !event._erased && event._sourceMapId === 1 && event._sourceeventId === 7 &&
                    event.x === x && event.y === y) $gameMap.clearSpawnEventQJ(event._eventId);
            }
        }
    }
    const labels = new Map();
    const initialWarps = new Map();
    for (const [mapId, fires] of Object.entries(sites)) {
        for (const { x, y, tx, ty, d, name, bossId } of fires) {
            const key = `${mapId}:${x},${y}`;
            labels.set(key, { name, bossId });
            initialWarps.set(key, { mapId: Number(mapId), tx, ty, d, bossId });
        }
    }

    const onMapLoaded = Scene_Map.prototype.onMapLoaded;
    Scene_Map.prototype.onMapLoaded = function() {
        const result = onMapLoaded.apply(this, arguments);
        removeRetiredCampfires();
        const allFires = sites[$gameMap.mapId()];
        if (!allFires?.some(isUnlocked)) return result;
        // 原生地圖用「有沒有任何營火」決定是否生成，新增時一併保留原生那座。
        const fires = allFires.filter(site => site.native || isUnlocked(site));
        for (const { x, y, native, ...requirements } of fires) {
            const existing = $gameMap._events.find(event => event && !event._erased && event.x === x && event.y === y);
            if (existing) {
                if (existing._sourceeventId === 7) existing.drill_COET_addTag?.("bonfire");
                if (native && isUnlocked(requirements) && existing._sourceeventId === 7 &&
                    !existing.cachedTags?.bonfireHasBurned) {
                    existing.cachedTags = { ...existing.cachedTags, bonfireLit: true, bonfireHasBurned: true };
                    QJ.MPMZ.tl.ex_bonfireInit(existing._eventId);
                }
                continue;
            }
            const eid = $gameMap.spawnEventQJ(1, 7, x, y, true, {
                cachedTags: { bonfireLit: true, bonfireHasBurned: true }
            });
            $gameMap.event(eid)?.drill_COET_addTag?.("bonfire");
        }
        $gameMap.drill_COEM_updateAvailableEventChanged?.();
        // 也修復更新前就已熄滅、並記錄在存檔中的火點。
        if ($gameMap.mapId() === 72) {
            for (const event of $gameMap._events) if (event) recoverLavaFire(event._eventId);
        }
        // 舊自動存檔可能記住已完成傳送、但尚未淡入的遮罩。
        const blackout = $gameScreen.picture(120);
        if (!this._transfer && blackout?.name() === "null(black)" &&
            blackout.opacity() > 0 && fires.some(({ x, y }) =>
                Math.abs($gamePlayer.x - x) <= 1.5 && Math.abs($gamePlayer.y - y) <= 1.5)) {
            $gameMap.steupCEQJ(5, 0);
        }
        return result;
    };

    const destinations = QJ.MPMZ.tl.ex_bonfireWarpDestinations;
    QJ.MPMZ.tl.ex_bonfireWarpDestinations = function() {
        removeRetiredCampfires();
        // 地圖事件尚未生成時也能傳送，由原版營火在抵達後複查落點。
        const warps = $gameSystem._bonfireWarps ||= {};
        for (const [key, { bossId, ...entry }] of initialWarps) {
            if (isUnlocked({ bossId })) warps[key] ??= { ...entry };
        }
        return destinations.apply(this, arguments).map(entry => {
            const label = labels.get(entry.key);
            return label && isUnlocked(label) ? { ...entry, name: label.name } : entry;
        });
    };

    const transfer = QJ.MPMZ.tl.ex_bonfireWarpTransfer;
    QJ.MPMZ.tl.ex_bonfireWarpTransfer = function() {
        const key = this._bonfireWarpTarget;
        const destination = key && $gameSystem._bonfireWarps?.[key];
        const result = transfer.apply(this, arguments);
        if (!destination || !$gamePlayer.isTransferring()) return result;
        const afterTransfer = this._index + 1;
        const next = this._list?.[afterTransfer];
        // 保留新版的轉場清理順序。複製指令表，避免改到範本或其他營火。
        if (next?.code === 117 && next.parameters[0] === 21 &&
            !(this._list[afterTransfer + 1]?.code === 117 &&
              this._list[afterTransfer + 1].parameters[0] === 5)) {
            this._list = this._list.slice();
            this._list.splice(afterTransfer + 1, 0, {
                code: 117, indent: next.indent, parameters: [5]
            });
        }
        return result;
    };

    // 熔岩場的冰／水攻擊可熄滅原版營火。戰後恢復這座新增火點，
    // 仍讓原版 BOSS 判斷控制戰鬥中能否互動，不改其他營火的元素反應。
    const bonfireTick = QJ.MPMZ.tl.ex_bonfireTick;
    QJ.MPMZ.tl.ex_bonfireTick = function() {
        recoverLavaFire(this.data.bonfireEventId);
        return bonfireTick.apply(this, arguments);
    };
})();
