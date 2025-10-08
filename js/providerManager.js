// js/providerManager.js
//Version 1.1.1
// This module manages all CRUD (Create, Read, Update, Delete) operations
// for electricity provider configurations. It uses the browser's localStorage
// for persistence, allowing provider data to be saved between sessions.

/*
 * Home Battery & Solar ROI Analyzer
 * Copyright (c) 2025 [DaSando62]
 *
 * This software is licensed under the MIT License.
 * Permission is hereby granted, free of charge, to any person obtaining a copy
 * of this software and associated documentation files (the "Software"), to deal
 * in the Software without restriction, including without limitation the rights
 * to use, copy, modify, merge, publish, distribute, sublicense, and/or sell
 * copies of the Software, and to permit persons to whom the Software is
 * furnished to do so, subject to the following conditions:
 *
 * The above copyright notice and this permission notice shall be included in all
 * copies or substantial portions of the Software.
 *
 * THE SOFTWARE IS PROVIDED "AS IS", WITHOUT WARRANTY OF ANY KIND, EXPRESS OR
 * IMPLIED, INCLUDING BUT NOT LIMITED TO THE WARRANTIES OF MERCHANTABILITY,
 * FITNESS FOR A PARTICULAR PURPOSE AND NONINFRINGEMENT. IN NO EVENT SHALL THE
 * AUTHORS OR COPYRIGHT HOLDERS BE LIABLE FOR ANY CLAIM, DAMAGES OR OTHER
 * LIABILITY, WHETHER IN AN ACTION OF CONTRACT, TORT OR OTHERWISE, ARISING FROM,
 * OUT OF OR IN CONNECTION WITH THE SOFTWARE OR THE USE OR OTHER DEALINGS IN THE
 * SOFTWARE.
 */

// --- Constants for localStorage keys ---
const PROVIDERS_KEY = 'roiAnalyzer_providers';
const DEFAULTS_LOADED_KEY = 'roiAnalyzer_defaults_loaded';

// A hardcoded array of default provider configurations.
// This is used to populate the application with initial data on first use.
const defaultProviders = [
    {
        id: "Origin",
        name: "Origin Energy",
		isExpanded: true,
        dailyCharge: 1.1605,
        rebate: 0,
        monthlyFee: 0,
        importRules: [
            { type: 'tou', name: 'Peak', rate: 0.59653, hours: '7am-10am, 4pm-10pm' },
            { type: 'tou', name: 'Shoulder', rate: 0.29425, hours: '10am-4pm' },
            { type: 'tou', name: 'Off-Peak', rate: 0.35233, hours: '10pm-7am' }
        ],
        exportRules: [
            { type: 'tiered', name: 'Tier 1', rate: 0.10, limit: 14 },
            { type: 'flat', name: 'Tier 2', rate: 0.02 }
        ],
		specialConditions: [], 
        gridChargeEnabled: false,
        gridChargeStart: 1,
        gridChargeEnd: 5
    },
    {
        id: "GloBird",
        name: "GloBird",
		isExpanded: true,
        dailyCharge: 1.364,
        rebate: 1500,
        zeroHeroCredit: -1.00,
        monthlyFee: 0,
        importRules: [
            { type: 'tou', name: 'Peak Import', rate: 0.528, hours: '3pm-11pm' },
            { type: 'tou', name: 'Shoulder Import', rate: 0.396, hours: '7am-11am, 10pm-12am' },
            { type: 'tou', name: 'Off-Peak Import', rate: 0.000, hours: '12am-7am, 11am-3pm' }
        ],
        exportRules: [
            { type: 'tiered', name: 'Super Export Bonus', rate: 0.120, limit: 10 },
            { type: 'tou', name: 'Peak Export', rate: 0.030, hours: '4pm-9pm' },
            { type: 'tou', name: 'Shoulder Export', rate: 0.003, hours: '9pm-10am, 2pm-4pm' },
            { type: 'tou', name: 'Solar Sponge', rate: 0.000, hours: '10am-2pm' }
        ],
		specialConditions: [
			{
				name: 'ZEROHERO Credit (Daylight Saving)',
				months: [10, 11, 12, 1, 2, 3], // Applies from October to March
				condition: { 
					metric: 'import_in_window',      
					hours: '6pm-8pm',               
					operator: 'less_than_or_equal_to',
					value: 0.06                     
				},
				action: { 
					type: 'flat_credit',
					value: 1.00 
				}
			},
			{
				name: 'ZEROHERO Credit (Standard Time)',
				months: [4, 5, 6, 7, 8, 9], // Applies from April to September
				condition: { 
					metric: 'import_in_window',
					hours: '5pm-7pm',
					operator: 'less_than_or_equal_to',
					value: 0.06
				},
				action: { 
					type: 'flat_credit',
					value: 1.00
				}
			}], 
        gridChargeEnabled: true,
        gridChargeStart: 11,
        gridChargeEnd: 15
    },
    {
        id: "Amber",
        name: "Amber",
		isExpanded: true,
        dailyCharge: 1.091,
        monthlyFee: 25,
        rebate: 1500,
        importRules: [
            { type: 'flat', name: 'Average Import', rate: 0.355 }
        ],
        exportRules: [
            { type: 'flat', name: 'Average Export', rate: 0.007 }
        ],
		specialConditions: [], 
        gridChargeEnabled: false,
        gridChargeStart: 23,
        gridChargeEnd: 5
    },
    {
        id: "AGL",
        name: "AGL Energy",
		isExpanded: true,
        dailyCharge: 1.2,
        rebate: 0,
        monthlyFee: 0,
        importRules: [
            { type: 'tou', name: 'Peak', rate: 0.5, hours: '3pm-11pm' },
            { type: 'tou', name: 'Shoulder', rate: 0.3, hours: '7am-11am, 11pm-12am' },
            { type: 'tou', name: 'Off-Peak', rate: 0.2, hours: '12am-7am, 11am-3pm' }
        ],
        exportRules: [
            { type: 'flat', name: 'Flat Rate', rate: 0.05 }
        ],
		specialConditions: [], 
        gridChargeEnabled: false,
        gridChargeStart: 0,
        gridChargeEnd: 7
    },
];

/**
 * Retrieves all provider configurations from localStorage.
 * @returns {Array<object>} An array of provider objects. Returns an empty array if none are found.
 */
export function getProviders() {
    const providersJson = localStorage.getItem(PROVIDERS_KEY);
    return providersJson ? JSON.parse(providersJson) : [];
}

/**
 * Saves an entire array of provider configurations to localStorage, overwriting any existing data.
 * @param {Array<object>} providersArray - The array of provider objects to save.
 */
export function saveAllProviders(providersArray) {
    localStorage.setItem(PROVIDERS_KEY, JSON.stringify(providersArray));
}

/**
 * Saves a single provider's configuration. It will update an existing provider
 * if the ID matches, or add it as a new provider if the ID is new.
 * @param {object} providerData - The provider object to save.
 */
export function saveProvider(providerData) {
    let allProviders = getProviders();
    const index = allProviders.findIndex(p => p.id === providerData.id);
    if (index > -1) {
        // Update existing provider at the found index.
        allProviders[index] = providerData;
    } else {
        // Add as a new provider. If no ID exists (new custom provider), create one.
        if (!providerData.id) providerData.id = `custom_${Date.now()}`;
        allProviders.push(providerData);
    }
    saveAllProviders(allProviders);
}

/**
 * Deletes a provider configuration from localStorage based on its ID.
 * @param {string} providerId - The ID of the provider to delete.
 */
export function deleteProvider(providerId) {
    let allProviders = getProviders();
    // Filter the array to exclude the provider with the matching ID.
    allProviders = allProviders.filter(p => p.id !== providerId);
    saveAllProviders(allProviders);
}

/**
 * Initializes the application with the default set of providers if no providers
 * have been loaded before. This ensures first-time users have some data to work with.
 */
export function initializeDefaultProviders() {
    // Check a flag in localStorage to see if defaults have ever been loaded.
    const defaultsLoaded = localStorage.getItem(DEFAULTS_LOADED_KEY);
    if (!defaultsLoaded) {
        // If not, save the default providers and set the flag.
        saveAllProviders(defaultProviders);
        localStorage.setItem(DEFAULTS_LOADED_KEY, 'true');
    }
}