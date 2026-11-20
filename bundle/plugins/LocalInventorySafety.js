/*:
 * @target MZ
 * @plugindesc 道具原有數量超過250時，取得不會刪除超額物品，使用仍正常減少。
 */
(() => {
    'use strict';
    const gainItem = Game_Party.prototype.gainItem;
    Game_Party.prototype.gainItem = function(item) {
        const last = item && DataManager.isItem(item) ? this.numItems(item) : 0;
        if (!(last > this.maxItems(item))) return gainItem.apply(this, arguments);
        const hadOwn = Object.prototype.hasOwnProperty.call(this, 'maxItems');
        const maxItems = this.maxItems;
        this.maxItems = function(current) {
            const limit = maxItems.call(this, current);
            return current === item ? Math.max(last, limit) : limit;
        };
        try { return gainItem.apply(this, arguments); }
        finally {
            if (hadOwn) this.maxItems = maxItems;
            else delete this.maxItems;
        }
    };
})();
