// js/config.js
//Version 9.6
import { getNumericInput, parseRangesToHours } from './utils.js';
import { getProviders } from './providerManager.js';

function getHoursFromInput(id) {
    const el = document.getElementById(id);
    if (!el || !el.value) return [];
    return parseRangesToHours(el.value);
}
export function gatherConfigFromUI() {
    // 1. Get the dynamic list of ALL providers from our manager
    const allProviders = getProviders();

    // 2. Gather all the main, non-provider-specific settings from the UI
    const config = {
        selectedProviders: Array.from(document.querySelectorAll(".providerCheckbox:checked")).map(cb => cb.value),
        useManual: document.getElementById("manualInputToggle")?.checked,
        noExistingSolar: document.getElementById("noExistingSolar")?.checked,
        existingSolarKW: getNumericInput("existingSolarKW"),
        newSolarKW: getNumericInput("newSolarKW"),
        replaceExistingSystem: document.getElementById("replaceExistingSystem")?.checked,
        newBatteryKWH: getNumericInput("newBattery"),
        newBatteryInverterKW: getNumericInput("newBatteryInverter", 5),
        costSolar: getNumericInput("costSolar"),
        costBattery: getNumericInput("costBattery"),
		blackoutSizingEnabled: document.getElementById("enableBlackoutSizing")?.checked,
        blackoutDuration: getNumericInput('blackoutDuration', 3),
        blackoutCoverage: getNumericInput('blackoutCoverage', 85) / 100,
        loanEnabled: document.getElementById("enableLoan")?.checked,
        discountRateEnabled: document.getElementById("enableDiscountRate")?.checked,
        loanAmount: getNumericInput("loanAmount"),
        loanInterestRate: getNumericInput("loanInterestRate") / 100,
        loanTerm: getNumericInput("loanTerm"),
        discountRate: getNumericInput("discountRate") / 100,
        numYears: getNumericInput("numYears", 15),
        tariffEscalation: getNumericInput("tariffEscalation", 2) / 100,
        solarDegradation: getNumericInput("solarDegradation", 0.5) / 100,
        batteryDegradation: getNumericInput("batteryDegradation", 2) / 100,
        gridChargeThreshold: getNumericInput("gridChargeThreshold", 80),
		socChargeTrigger: getNumericInput("socChargeTrigger", 50),
        manualSolarProfile: getNumericInput("manualSolarProfile", 4),
		recommendationCoverageTarget: getNumericInput('recommendationCoverageTarget', 90),
        providers: {} // Initialize an empty object for provider data
    };

    // 3. This loop now correctly uses the dynamic provider list to build the config
    config.selectedProviders.forEach(pKey => {
        const pData = allProviders[pKey];
        if (!pData) return; // Failsafe if a selected provider doesn't exist

        // The data (rates, names, etc.) is already in pData from localStorage.
        // We just need to parse the hour strings into arrays for the simulation.
        const importData = {
            peak: parseFloat(pData.peakRate) || 0,
            shoulder: parseFloat(pData.shoulderRate) || 0,
            offPeak: parseFloat(pData.offPeakRate) || 0,
            rate: parseFloat(pData.importRate) || 0,
            peakHours: parseRangesToHours(pData.peakHours || ''),
            shoulderHours: parseRangesToHours(pData.shoulderHours || ''),
            offPeakHours: parseRangesToHours(pData.offPeakHours || '')
        };
        
        const importRates = [];
        if (pData.importComponent === 'TIME_OF_USE_IMPORT') {
            importRates.push({ name: "Peak", hours: importData.peakHours, rate: importData.peak });
            importRates.push({ name: "Shoulder", hours: importData.shoulderHours, rate: importData.shoulder });
            importRates.push({ name: "Off-Peak", hours: importData.offPeakHours, rate: importData.offPeak });
        } else if (pData.importComponent === 'FLAT_RATE_IMPORT') {
            importRates.push({ name: "Flat Rate", hours: Array.from({length: 24}, (_, i) => i), rate: importData.rate });
        }

        const exportRule = { type: pData.exportType };
        let exportData = {};
        
        if (pData.exportComponent === 'GLOBIRD_COMPLEX_FIT') {
            exportData = {
                bonusRate: parseFloat(pData.superExportRate) || 0,
                bonusLimit: parseFloat(pData.superExportLimit) || 0,
                touRates: [
                    { name: "4pm-9pm", hours: [16, 17, 18, 19, 20, 21], rate: parseFloat(pData.export4pm9pmRate) || 0 },
                    { name: "10am-2pm", hours: [10, 11, 12, 13], rate: parseFloat(pData.export10am2pmRate) || 0 },
                    { name: "Other", hours: [0,1,2,3,4,5,6,7,8,9,14,15,22,23], rate: parseFloat(pData.export9pm10am2pm4pmRate) || 0 }
                ]
            };
            exportRule.rate = parseFloat(pData.superExportRate) || 0;
        } else if (pData.exportComponent === 'MULTI_TIER_FIT') {
            exportRule.tiers = [
                { limit: parseFloat(pData.export1Limit) || 0, rate: parseFloat(pData.export1Rate) || 0 },
                { limit: Infinity, rate: parseFloat(pData.export2Rate) || 0 }
            ];
            exportData = exportRule;
        } else if (pData.exportComponent === 'FLAT_RATE_FIT') {
            exportRule.rate = parseFloat(pData.exportRate) || 0;
            exportData = exportRule;
        }

        //config.providers[pKey] = {
            //...pData,
            //dailyCharge: parseFloat(pData.dailyCharge) || 0,
            //rebate: parseFloat(pData.rebate) || 0,
            //monthlyFee: parseFloat(pData.monthlyFee) || 0,
            //importData: importData,
            //importRates: importRates,
            //exportData: exportData,
            //exportRates: [exportRule]
        //};
		config.providers[pKey] = {
			// The `...pData` line has been removed.
			// We explicitly keep the properties we need from pData.
			id: pData.id,
			name: pData.name,
			importComponent: pData.importComponent,
			exportComponent: pData.exportComponent,
			exportType: pData.exportType,
			gridChargeEnabled: pData.gridChargeEnabled || false,
			gridChargeStart: parseInt(pData.gridChargeStart, 10) || 0,
			gridChargeEnd: parseInt(pData.gridChargeEnd, 10) || 0,
			// Now we add the parsed and cleaned-up data.
			dailyCharge: parseFloat(pData.dailyCharge) || 0,
			rebate: parseFloat(pData.rebate) || 0,
			monthlyFee: parseFloat(pData.monthlyFee) || 0,
			importData: importData,
			importRates: importRates,
			exportData: exportData,
			exportRates: [exportRule]
		};		
    });

    config.initialSystemCost = config.costSolar + config.costBattery;
    if (config.loanEnabled && config.loanAmount > 0) {
        const i = config.loanInterestRate / 12;
        const n = config.loanTerm * 12;
        if (i > 0 && n > 0) {
            config.annualLoanRepayment = (config.loanAmount * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)) * 12;
        } else {
            config.annualLoanRepayment = 0;
        }
    } else {
        config.annualLoanRepayment = 0;
    }
    return config;
}