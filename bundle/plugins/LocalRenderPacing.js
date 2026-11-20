/*:
 * @target MZ
 * @plugindesc 遊戲畫面隨邏輯更新重繪，減少高更新率螢幕上的重複繪圖。
 * @help
 * 不更動遊戲邏輯計時器。高更新率螢幕上，每次邏輯更新最多重繪一次。
 * 可在開發者主控台使用 LocalRenderPacing.enabled = false 暫停。
 */
(() => {
    "use strict";

    const state = window.LocalRenderPacing = { enabled: true };
    const canRender = Graphics._canRender;
    let lastFrame;
    let lastStage;
    let lastRenderer;

    Graphics._canRender = function() {
        if (!canRender.apply(this, arguments)) return false;
        const stage = this._app.stage;
        const renderer = this._app.renderer;
        if (state.enabled && lastFrame === this.frameCount &&
            lastStage === stage && lastRenderer === renderer) return false;
        lastFrame = this.frameCount;
        lastStage = stage;
        lastRenderer = renderer;
        return true;
    };
})();
