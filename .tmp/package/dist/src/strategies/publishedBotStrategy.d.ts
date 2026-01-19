/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import type { Strategy } from './strategy';
/** @deprecated This interface will not be supported in future versions. Use StrategySettings instead. */
export interface PublishedBotStrategySettings {
    readonly host: URL;
    readonly schema: string;
}
/**
 * Strategy for constructing PowerPlatform API connection URLs for published agents.
 */
export declare class PublishedBotStrategy implements Strategy {
    private readonly API_VERSION;
    private baseURL;
    constructor(settings: PublishedBotStrategySettings);
    getConversationUrl(conversationId?: string): string;
}
