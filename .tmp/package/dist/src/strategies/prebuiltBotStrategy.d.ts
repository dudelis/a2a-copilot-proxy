/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
import type { Strategy, StrategySettings } from './strategy';
/** @deprecated This interface will not be supported in future versions. Use StrategySettings instead. */
export interface PrebuiltBotStrategySettings {
    readonly host: URL;
    readonly identifier: string;
}
/**
 * Strategy for constructing PowerPlatform API connection URLs for prebuilt agents.
 */
export declare class PrebuiltBotStrategy implements Strategy {
    private readonly API_VERSION;
    private baseURL;
    /**
     * @deprecated This constructor will not be supported in future versions. Use constructor (settings: StrategySettings).
     */
    constructor(settings: PrebuiltBotStrategySettings);
    constructor(settings: StrategySettings);
    getConversationUrl(conversationId?: string): string;
}
