// js/config.js
//Version 1.1.1
// This module is responsible for gathering all user-configurable settings from the UI
// and assembling them into a single configuration object used by the analysis engine.

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

import { getNumericInput } from './utils.js';
import { getProviders } from './providerManager.js';

/**
 * Reads all input fields, checkboxes, and provider settings from the DOM
 * and returns a comprehensive configuration object.
 * @returns {object} The complete analysis configuration object.
 */
export function gatherConfigFromUI() {
    // Get the full, up-to-date list of all provider configurations from the provider manager.
    const allProviders = getProviders(); 
    
    // Get the IDs of only the providers the user has checked for inclusion in the analysis.
    const selectedProviderIds = Array.from(document.querySelectorAll(".providerCheckbox:checked")).map(cb => cb.value);

    // Determine if the user is using manual data entry or CSV upload.
    const useManual = document.getElementById("manualInputToggle")?.checked;

    // The main configuration object.
    const config = {
        // --- General Settings ---
        selectedProviders: selectedProviderIds, // IDs of providers to analyze
        useManual: useManual,
        noExistingSolar: document.getElementById("noExistingSolar")?.checked,
        
        // --- System Sizing ---
        existingSolarKW: getNumericInput("existingSolarKW"),
        existingBattery: getNumericInput("existingBattery"),
        existingBatteryInverter: getNumericInput("existingBatteryInverter"),
        existingSystemAge: getNumericInput("existingSystemAge", 0), // Age for degradation calculation
        newSolarKW: getNumericInput("newSolarKW"),
        replaceExistingSystem: document.getElementById("replaceExistingSystem")?.checked,
        newBatteryKWH: getNumericInput("newBattery"),
        newBatteryInverterKW: getNumericInput("newBatteryInverter"),
        costSolar: getNumericInput("costSolar"),
        costBattery: getNumericInput("costBattery"),
		
        // --- Blackout & Sizing Recommendation Settings ---
        blackoutSizingEnabled: document.getElementById("enableBlackoutSizing")?.checked,
        blackoutDuration: getNumericInput('blackoutDuration'), // hours
        blackoutCoverage: getNumericInput('blackoutCoverage') / 100, // as a decimal
        recommendationCoverageTarget: getNumericInput('recommendationCoverageTarget', 90),
        
        // --- Financial Settings ---
        loanEnabled: document.getElementById("enableLoan")?.checked,
        discountRateEnabled: document.getElementById("enableDiscountRate")?.checked,
        loanAmount: getNumericInput("loanAmount"),
        loanInterestRate: getNumericInput("loanInterestRate") / 100, // as a decimal
        loanTerm: getNumericInput("loanTerm"), // in years
        discountRate: getNumericInput("discountRate") / 100, // as a decimal for NPV
        
        // --- Analysis Period & Degradation ---
        numYears: getNumericInput("numYears", 15),
        tariffEscalation: getNumericInput("tariffEscalation", 2) / 100, // annual % increase
        solarDegradation: getNumericInput("solarDegradation", 0.5) / 100, // annual % loss
        batteryDegradation: getNumericInput("batteryDegradation", 2) / 100, // annual % loss
        fitDegradationStartYear: getNumericInput("fitDegradationStartYear", 1),
        fitDegradationEndYear: getNumericInput("fitDegradationEndYear", 10),
        fitMinimumRate: getNumericInput("fitMinimumRate", -0.03), // Final floor for FIT rate
        
        // --- Battery-specific Settings ---
        gridChargeThreshold: getNumericInput("gridChargeThreshold", 80), // Max SOC to charge to from grid
		socChargeTrigger: getNumericInput("socChargeTrigger", 50),    // SOC level below which grid charging is allowed
        
        // --- Manual Mode Data ---
        manualSolarProfile: getNumericInput("manualSolarProfile", 4.0), // kWh generated per kW of panels
        manualData: null, // This will be populated if useManual is true

        // Filter the full list of providers to only include the selected ones.
        providers: allProviders.filter(p => selectedProviderIds.includes(p.id))
    };

    // If in manual mode, gather the seasonal average daily values.
    if (useManual) {
        config.manualData = {
            'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
        };
    }

    // Calculate the total initial investment cost.
    config.initialSystemCost = config.costSolar + config.costBattery;

    // Calculate the annual loan repayment amount if a loan is enabled and valid.
    if (config.loanEnabled && config.loanAmount > 0 && config.loanInterestRate > 0 && config.loanTerm > 0) {
        const i = config.loanInterestRate / 12; // monthly interest rate
        const n = config.loanTerm * 12; // total number of payments
        // Standard loan amortization formula to find monthly payment.
        const monthlyPayment = (config.loanAmount * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        config.annualLoanRepayment = monthlyPayment * 12;
    } else {
        config.annualLoanRepayment = 0;
    }

    return config;
}