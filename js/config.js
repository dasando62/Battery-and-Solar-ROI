// js/config.js
//Version 1.3.4
// This module is responsible for gathering all user-configurable settings from the UI
// and assembling them into a single configuration object used by the analysis engine.

/*
 * Home Battery & Solar ROI Analyser
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

import { getNumericInput } from './utils.js';
import { getProviders } from './providerManager.js';
import { SEASONS } from './constants.js';

/**
 * Reads all input fields, checkboxes, and provider settings from the DOM
 * and returns a comprehensive configuration object.
 * @returns {object} The complete analysis configuration object.
 */
export function gatherConfigFromUI() {
    const allProviders = getProviders();
    const selectedProviderIds = Array.from(document.querySelectorAll(".providerCheckbox:checked")).map(cb => cb.value);
    const useManual = document.getElementById("manualInputToggle")?.checked;

    const config = {
        // --- General Settings ---
        selectedProviders: selectedProviderIds,
        useManual: useManual,
        noExistingSolar: document.getElementById("noExistingSolar")?.checked,

        // --- Controlled Load Settings ---
        moveControlledLoad: document.getElementById("moveControlledLoad")?.checked,
        controlledLoadIdentifier: document.getElementById('controlledLoadIdentifier')?.value || '',

        // --- System Sizing ---
        existingSolarKW: getNumericInput("existingSolarKW"),
        existingSolarInverterKW: getNumericInput("existingSolarInverter"),
        isHybridInverter: document.getElementById("isHybridInverter")?.checked,
        existingBattery: getNumericInput("existingBattery"),
        existingBatteryInverter: getNumericInput("existingBatteryInverter"),
        existingSystemAge: getNumericInput("existingSystemAge", 0),
        newSolarKW: getNumericInput("newSolarKW"),
        replaceExistingSystem: document.getElementById("replaceExistingSystem")?.checked,
        newBatteryKWH: getNumericInput("newBattery"),
        newBatteryInverterKW: getNumericInput("newBatteryInverter"),
        isAcCoupled: document.getElementById("isAcCoupled")?.checked,
        costSolar: getNumericInput("costSolar"),
        costBattery: getNumericInput("costBattery"),

        // --- EV Charging Settings ---
        evChargingEnabled: document.getElementById('enableEVCharging')?.checked,
        evDailyKM: getNumericInput('evDailyKM', 40),
        evEfficiency: getNumericInput('evEfficiency', 18.5),
        minSOCForEV: getNumericInput('minSOCForEV', 50),

        // --- Blackout & Sizing Recommendation Settings ---
        blackoutSizingEnabled: document.getElementById("enableBlackoutSizing")?.checked,
        blackoutDuration: getNumericInput('blackoutDuration'),
        blackoutCoverage: getNumericInput('blackoutCoverage') / 100,
        recommendationCoverageTarget: getNumericInput('recommendationCoverageTarget', 90),

        // --- Financial Settings ---
        loanEnabled: document.getElementById("enableLoan")?.checked,
        discountRateEnabled: document.getElementById("enableDiscountRate")?.checked,
        loanAmount: getNumericInput("loanAmount"),
        loanInterestRate: getNumericInput("loanInterestRate") / 100,
        loanTerm: getNumericInput("loanTerm"),
        discountRate: getNumericInput("discountRate") / 100,

        // --- Analysis Period & Degradation ---
        numYears: getNumericInput("numYears", 15),
        tariffEscalation: getNumericInput("tariffEscalation", 2) / 100,
        solarDegradation: getNumericInput("solarDegradation", 0.5) / 100,
        batteryDegradation: getNumericInput("batteryDegradation", 2) / 100,
        fitDegradationStartYear: getNumericInput("fitDegradationStartYear", 1),
        fitDegradationEndYear: getNumericInput("fitDegradationEndYear", 10),
        fitMinimumRate: getNumericInput("fitMinimumRate", 0.00), // Corrected default

        // --- Battery-specific Settings ---
        gridChargeThreshold: getNumericInput("gridChargeThreshold", 80),
        socChargeTrigger: getNumericInput("socChargeTrigger", 50),

        // --- Solar Yield (Manual Mode Only) ---
        newSolarYield: getNumericInput("newSolarYield", 4.0), // Used only in manual mode for new panels

        // --- Manual Mode Data --- Initialize here! ---
        manualData: null,

        // Filter the full list of providers to only include the selected ones.
        providers: allProviders.filter(p => selectedProviderIds.includes(p.id)),

        // Initialize calculated properties
        initialSystemCost: 0,
        annualLoanRepayment: 0,
        manualTotalDays: 365 // Default annualization days
    };

    // --- NOW Populate manualData if needed ---
    if (useManual) {
        const isFlatRate = document.getElementById('manualFlatRateToggle')?.checked;
        config.manualData = {}; // Overwrite null with an empty object

        const seasons = {
            [SEASONS.SUMMER]: "summer",
            [SEASONS.AUTUMN]: "autumn",
            [SEASONS.WINTER]: "winter",
            [SEASONS.SPRING]: "spring",
        };

        for (const seasonKey in seasons) {
            const prefix = seasons[seasonKey];
            const daysInQ = getNumericInput(`${prefix}Days`);

            config.manualData[seasonKey] = {
                days: daysInQ,
                totalExport: getNumericInput(`${prefix}TotalExport`),
                totalControlledLoad: getNumericInput(`${prefix}TotalControlledLoad`),
                totalSolar: getNumericInput(`${prefix}TotalSolar`),
                isFlatRate: isFlatRate
            };

            if (isFlatRate) {
                config.manualData[seasonKey].totalFlatImport = getNumericInput(`${prefix}TotalImport`);
                config.manualData[seasonKey].totalPeakImport = 0;
                config.manualData[seasonKey].totalShoulderImport = 0;
                config.manualData[seasonKey].totalOffPeakImport = 0;
            } else {
                config.manualData[seasonKey].totalPeakImport = getNumericInput(`${prefix}TotalPeakImport`);
                config.manualData[seasonKey].totalShoulderImport = getNumericInput(`${prefix}TotalShoulderImport`);
                config.manualData[seasonKey].totalOffPeakImport = getNumericInput(`${prefix}TotalOffPeakImport`);
                config.manualData[seasonKey].totalFlatImport = 0;
            }
        }

        const totalManualDays = Object.values(config.manualData).reduce((sum, q) => sum + (q.days || 0), 0);
        config.manualTotalDays = totalManualDays > 0 ? totalManualDays : 365;
    }

    // --- Calculate costs AFTER potentially populating manualData ---
    config.initialSystemCost = config.costSolar + config.costBattery;

    if (config.loanEnabled && config.loanAmount > 0 && config.loanInterestRate > 0 && config.loanTerm > 0) {
        const i = config.loanInterestRate / 12;
        const n = config.loanTerm * 12;
        const monthlyPayment = (config.loanAmount * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        config.annualLoanRepayment = monthlyPayment * 12;
    } else {
        config.annualLoanRepayment = 0;
    }

    return config;
}