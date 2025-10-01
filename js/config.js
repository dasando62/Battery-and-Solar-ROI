// js/config.js
//Version 1.0.3
import { getNumericInput, parseRangesToHours } from './utils.js';
import { getProviders } from './providerManager.js';

export function gatherConfigFromUI() {
    // Get the full, up-to-date list of all provider configurations
    const allProviders = getProviders(); 
    
    // Get the IDs of only the providers the user has checked
    const selectedProviderIds = Array.from(document.querySelectorAll(".providerCheckbox:checked")).map(cb => cb.value);

    const config = {
        // General Settings
        selectedProviders: selectedProviderIds,
        useManual: document.getElementById("manualInputToggle")?.checked,
        noExistingSolar: document.getElementById("noExistingSolar")?.checked,
        
        // System Sizing
        existingSolarKW: getNumericInput("existingSolarKW"),
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
        
        // Battery Settings
        gridChargeThreshold: getNumericInput("gridChargeThreshold", 80),
		socChargeTrigger: getNumericInput("socChargeTrigger", 50),
        
        // Manual Mode Settings
        manualSolarProfile: getNumericInput("manualSolarProfile", 4),

        // --- NEW SIMPLIFIED PROVIDER LOGIC ---
        // Filter the full list of providers to include only the ones selected for this analysis.
        // The provider objects in 'allProviders' already have the correct structure with import/export rules.
        providers: allProviders.filter(p => selectedProviderIds.includes(p.id))
    };

    // Calculate total system cost
    config.initialSystemCost = config.costSolar + config.costBattery;

    // Calculate loan repayments if enabled
    if (config.loanEnabled && config.loanAmount > 0 && config.loanInterestRate > 0 && config.loanTerm > 0) {
        const i = config.loanInterestRate / 12; // Monthly interest rate
        const n = config.loanTerm * 12; // Total number of payments
        const monthlyPayment = (config.loanAmount * i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1);
        config.annualLoanRepayment = monthlyPayment * 12;
    } else {
        config.annualLoanRepayment = 0;
    }

    return config;
}