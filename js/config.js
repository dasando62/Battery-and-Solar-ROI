// js/config.js
//Version 1.1.0

import { getNumericInput } from './utils.js';
import { getProviders } from './providerManager.js';

export function gatherConfigFromUI() {
    // Get the full, up-to-date list of all provider configurations
    const allProviders = getProviders(); 
    
    // Get the IDs of only the providers the user has checked
    const selectedProviderIds = Array.from(document.querySelectorAll(".providerCheckbox:checked")).map(cb => cb.value);

    const useManual = document.getElementById("manualInputToggle")?.checked;

    const config = {
        // General Settings
        selectedProviders: selectedProviderIds,
        useManual: useManual,
        noExistingSolar: document.getElementById("noExistingSolar")?.checked,
        
        // System Sizing
        existingSolarKW: getNumericInput("existingSolarKW"),
        existingBattery: getNumericInput("existingBattery"), // Make sure this is here
        existingBatteryInverter: getNumericInput("existingBatteryInverter"), // Make sure this is here
        existingSystemAge: getNumericInput("existingSystemAge", 0), // <-- THIS IS THE NEW LINE
        newSolarKW: getNumericInput("newSolarKW"),
        replaceExistingSystem: document.getElementById("replaceExistingSystem")?.checked,
        newBatteryKWH: getNumericInput("newBattery"),
        newBatteryInverterKW: getNumericInput("newBatteryInverter"),
        costSolar: getNumericInput("costSolar"),
        costBattery: getNumericInput("costBattery"),
		
        // Blackout & Sizing Settings
        blackoutSizingEnabled: document.getElementById("enableBlackoutSizing")?.checked,
        blackoutDuration: getNumericInput('blackoutDuration'),
        blackoutCoverage: getNumericInput('blackoutCoverage') / 100,
        recommendationCoverageTarget: getNumericInput('recommendationCoverageTarget', 90),
        
        // Financial Settings
        loanEnabled: document.getElementById("enableLoan")?.checked,
        discountRateEnabled: document.getElementById("enableDiscountRate")?.checked,
        loanAmount: getNumericInput("loanAmount"),
        loanInterestRate: getNumericInput("loanInterestRate") / 100,
        loanTerm: getNumericInput("loanTerm"),
        discountRate: getNumericInput("discountRate") / 100,
        
        // Analysis Period & Degradation
        numYears: getNumericInput("numYears", 15),
        tariffEscalation: getNumericInput("tariffEscalation", 2) / 100,
        solarDegradation: getNumericInput("solarDegradation", 0.5) / 100,
        batteryDegradation: getNumericInput("batteryDegradation", 2) / 100,
        fitDegradationStartYear: getNumericInput("fitDegradationStartYear", 1),
        fitDegradationEndYear: getNumericInput("fitDegradationEndYear", 10),
        fitMinimumRate: getNumericInput("fitMinimumRate", -0.03),
        
        // Battery Settings
        gridChargeThreshold: getNumericInput("gridChargeThreshold", 80),
		socChargeTrigger: getNumericInput("socChargeTrigger", 50),
        
        // Manual Mode Settings
        manualSolarProfile: getNumericInput("manualSolarProfile", 4.0),
        manualData: null,

        providers: allProviders.filter(p => selectedProviderIds.includes(p.id))
    };

    if (useManual) {
        config.manualData = {
            'Q1_Summer': { avgPeak: getNumericInput("summerDailyPeak"), avgShoulder: getNumericInput("summerDailyShoulder"), avgOffPeak: getNumericInput("summerDailyOffPeak"), avgSolar: getNumericInput("summerDailySolar") },
            'Q2_Autumn': { avgPeak: getNumericInput("autumnDailyPeak"), avgShoulder: getNumericInput("autumnDailyShoulder"), avgOffPeak: getNumericInput("autumnDailyOffPeak"), avgSolar: getNumericInput("autumnDailySolar") },
            'Q3_Winter': { avgPeak: getNumericInput("winterDailyPeak"), avgShoulder: getNumericInput("winterDailyShoulder"), avgOffPeak: getNumericInput("winterDailyOffPeak"), avgSolar: getNumericInput("winterDailySolar") },
            'Q4_Spring': { avgPeak: getNumericInput("springDailyPeak"), avgShoulder: getNumericInput("springDailyShoulder"), avgOffPeak: getNumericInput("springDailyOffPeak"), avgSolar: getNumericInput("springDailySolar") },
        };
    }

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