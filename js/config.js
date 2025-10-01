// js/config.js
//Version 1.0.2
import { getNumericInput, parseRangesToHours } from './utils.js';
import { getProviders } from './providerManager.js';

export function gatherConfigFromUI() {
    const allProviders = getProviders(); // This is now an array
    const selectedProviderIds = Array.from(document.querySelectorAll(".providerCheckbox:checked")).map(cb => cb.value);

    const config = {
        selectedProviders: selectedProviderIds,
        useManual: document.getElementById("manualInputToggle")?.checked,
        noExistingSolar: document.getElementById("noExistingSolar")?.checked,
        existingSolarKW: getNumericInput("existingSolarKW"),
        newSolarKW: getNumericInput("newSolarKW"),
        replaceExistingSystem: document.getElementById("replaceExistingSystem")?.checked,
        newBatteryKWH: getNumericInput("newBattery"),
        newBatteryInverterKW: getNumericInput("newBatteryInverter"),
        costSolar: getNumericInput("costSolar"),
        costBattery: getNumericInput("costBattery"),
		blackoutSizingEnabled: document.getElementById("enableBlackoutSizing")?.checked,
        blackoutDuration: getNumericInput('blackoutDuration'),
        blackoutCoverage: getNumericInput('blackoutCoverage') / 100,
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
        providers: [] // Initialize as an ARRAY
    };

    // Find the selected providers from the main array and add them to the config
    selectedProviderIds.forEach(id => {
        const pData = allProviders.find(p => p.id === id);
        if (pData) {
            const importData = {
                peak: parseFloat(pData.peakRate) || 0, shoulder: parseFloat(pData.shoulderRate) || 0, offPeak: parseFloat(pData.offPeakRate) || 0,
                rate: parseFloat(pData.importRate) || 0,
                peakHours: parseRangesToHours(pData.peakHours || ''), shoulderHours: parseRangesToHours(pData.shoulderHours || ''), offPeakHours: parseRangesToHours(pData.offPeakHours || '')
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
            if (pData.exportComponent === 'MULTI_TIER_FIT') {
                exportRule.tiers = [
                    { limit: parseFloat(pData.export1Limit) || 0, rate: parseFloat(pData.export1Rate) || 0 },
                    { limit: Infinity, rate: parseFloat(pData.export2Rate) || 0 }
                ];
                exportData = exportRule;
            } else if (pData.exportComponent === 'FLAT_RATE_FIT') {
                exportRule.rate = parseFloat(pData.exportRate) || 0;
                exportData = exportRule;
            } else if (pData.exportComponent === 'GLOBIRD_COMPLEX_FIT') {
                // These property names now match what calculateGloBirdComplexFit expects
                exportRule.bonusLimit = parseFloat(pData.superExportLimit) || 0;
                exportRule.bonusRate = parseFloat(pData.superExportRate) || 0;
                exportRule.touRates = [
                    { name: "Peak Export", hours: parseRangesToHours('4pm-9pm'), rate: parseFloat(pData.export4pm9pmRate) || 0 },
                    { name: "Shoulder Export", hours: parseRangesToHours('9pm-10am, 2pm-4pm'), rate: parseFloat(pData.export9pm10am2pm4pmRate) || 0 },
                    { name: "Solar Sponge Export", hours: parseRangesToHours('10am-2pm'), rate: parseFloat(pData.export10am2pmRate) || 0 }
                ];
                exportData = exportRule;
            }
            const providerConfigObject = {
                id: pData.id, name: pData.name, importComponent: pData.importComponent, exportComponent: pData.exportComponent, exportType: pData.exportType,
                gridChargeEnabled: pData.gridChargeEnabled || false, gridChargeStart: parseInt(pData.gridChargeStart, 10) || 0, gridChargeEnd: parseInt(pData.gridChargeEnd, 10) || 0,
                dailyCharge: parseFloat(pData.dailyCharge) || 0, rebate: parseFloat(pData.rebate) || 0, monthlyFee: parseFloat(pData.monthlyFee) || 0,
                importData: importData, importRates: importRates, exportData: exportData, exportRates: [exportRule]
            };
            config.providers.push(providerConfigObject);
        }
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