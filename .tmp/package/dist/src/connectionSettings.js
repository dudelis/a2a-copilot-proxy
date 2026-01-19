"use strict";
/**
 * Copyright (c) Microsoft Corporation. All rights reserved.
 * Licensed under the MIT License.
 */
Object.defineProperty(exports, "__esModule", { value: true });
exports.loadCopilotStudioConnectionSettingsFromEnv = exports.ConnectionSettings = void 0;
const agentType_1 = require("./agentType");
const powerPlatformCloud_1 = require("./powerPlatformCloud");
/**
 * Configuration options for establishing a connection to Copilot Studio.
 */
class ConnectionOptions {
    constructor() {
        /** Flag to use the experimental endpoint if available */
        this.useExperimentalEndpoint = false;
    }
}
/**
 * Represents the settings required to establish a connection to Copilot Studio.
 */
class ConnectionSettings extends ConnectionOptions {
    /**
     * @private
     */
    constructor(options) {
        var _a, _b, _c;
        super();
        if (!options) {
            return;
        }
        const cloud = ((_a = options.cloud) === null || _a === void 0 ? void 0 : _a.trim()) || powerPlatformCloud_1.PowerPlatformCloud.Prod;
        const copilotAgentType = ((_b = options.copilotAgentType) === null || _b === void 0 ? void 0 : _b.trim()) || agentType_1.AgentType.Published;
        const authority = ((_c = options.authority) === null || _c === void 0 ? void 0 : _c.trim()) || 'https://login.microsoftonline.com';
        if (!Object.values(powerPlatformCloud_1.PowerPlatformCloud).includes(cloud)) {
            throw new Error(`Invalid PowerPlatformCloud: '${cloud}'. Supported values: ${Object.values(powerPlatformCloud_1.PowerPlatformCloud).join(', ')}`);
        }
        if (!Object.values(agentType_1.AgentType).includes(copilotAgentType)) {
            throw new Error(`Invalid AgentType: '${copilotAgentType}'. Supported values: ${Object.values(agentType_1.AgentType).join(', ')}`);
        }
        Object.assign(this, { ...options, cloud, copilotAgentType, authority });
    }
}
exports.ConnectionSettings = ConnectionSettings;
/**
 * Loads the connection settings for Copilot Studio from environment variables.
 * @returns The connection settings.
 */
const loadCopilotStudioConnectionSettingsFromEnv = () => {
    var _a, _b, _c, _d, _e, _f, _g;
    return new ConnectionSettings({
        appClientId: (_a = process.env.appClientId) !== null && _a !== void 0 ? _a : '',
        tenantId: (_b = process.env.tenantId) !== null && _b !== void 0 ? _b : '',
        authority: (_c = process.env.authorityEndpoint) !== null && _c !== void 0 ? _c : 'https://login.microsoftonline.com',
        environmentId: (_d = process.env.environmentId) !== null && _d !== void 0 ? _d : '',
        agentIdentifier: (_e = process.env.agentIdentifier) !== null && _e !== void 0 ? _e : '',
        schemaName: (_f = process.env.schemaName) !== null && _f !== void 0 ? _f : '',
        cloud: process.env.cloud,
        customPowerPlatformCloud: process.env.customPowerPlatformCloud,
        copilotAgentType: process.env.copilotAgentType,
        directConnectUrl: process.env.directConnectUrl,
        useExperimentalEndpoint: ((_g = process.env.useExperimentalEndpoint) === null || _g === void 0 ? void 0 : _g.toLowerCase()) === 'true'
    });
};
exports.loadCopilotStudioConnectionSettingsFromEnv = loadCopilotStudioConnectionSettingsFromEnv;
//# sourceMappingURL=connectionSettings.js.map