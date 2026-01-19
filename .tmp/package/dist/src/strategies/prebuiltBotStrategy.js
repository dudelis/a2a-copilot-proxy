"use strict";
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.PrebuiltBotStrategy = void 0;
/**
 * Strategy for constructing PowerPlatform API connection URLs for prebuilt agents.
 */
class PrebuiltBotStrategy {
    constructor(settings) {
        this.API_VERSION = '2022-03-01-preview';
        const schema = 'schema' in settings ? settings.schema : settings.identifier;
        const host = settings.host;
        this.baseURL = new URL(`/copilotstudio/prebuilt/authenticated/bots/${schema}`, host);
        this.baseURL.searchParams.append('api-version', this.API_VERSION);
    }
    getConversationUrl(conversationId) {
        const conversationUrl = new URL(this.baseURL.href);
        conversationUrl.pathname = `${conversationUrl.pathname}/conversations`;
        if (conversationId) {
            conversationUrl.pathname = `${conversationUrl.pathname}/${conversationId}`;
        }
        return conversationUrl.href;
    }
}
exports.PrebuiltBotStrategy = PrebuiltBotStrategy;
//# sourceMappingURL=prebuiltBotStrategy.js.map