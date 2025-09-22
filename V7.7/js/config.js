// js/config.js
//Version 7.7
import { getNumericInput, parseRangesToHours } from './utils.js';
import { providers } from './providers.js';

function getHoursFromInput(id) {
    const el = document.getElementById(id);
    if (!el || !el.value) return [];
    return parseRangesToHours(el.value);
}
export function gatherConfigFromUI() {
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
        manualSolarProfile: getNumericInput("manualSolarProfile", 4),
        providers: {}
    };
    for (const pKey in providers) {
        if (!providers.hasOwnProperty(pKey)) continue;
        const pData = providers[pKey];
        const pId = pKey.toLowerCase();
        const importData = {};
        if (pData.importComponent === 'TIME_OF_USE_IMPORT') {
            importData.peak = getNumericInput(`${pId}PeakRate`);
            importData.shoulder = getNumericInput(`${pId}ShoulderRate`);
            importData.offPeak = getNumericInput(`${pId}OffPeakRate`);
        } else if (pData.importComponent === 'FLAT_RATE_IMPORT') {
            importData.rate = getNumericInput(`${pId}ImportRate`);
        }
        const exportRule = { type: pData.exportType };
        if (pData.exportComponent === 'MULTI_TIER_FIT') {
            exportRule.tiers = [ { limit: getNumericInput(`${pId}Export1Limit`), rate: getNumericInput(`${pId}Export1Rate`) }, { limit: Infinity, rate: getNumericInput(`${pId}Export2Rate`) } ];
        } else if (pData.exportComponent === 'FLAT_RATE_FIT') {
            exportRule.rate = getNumericInput(`${pId}ExportRate`);
        }
        const importRatesWithHours = [];
        if (pData.importComponent === 'TIME_OF_USE_IMPORT') {
            importRatesWithHours.push({ name: "Peak", hours: getHoursFromInput(`${pId}PeakHours`), rate: importData.peak });
            importRatesWithHours.push({ name: "Shoulder", hours: getHoursFromInput(`${pId}ShoulderHours`), rate: importData.shoulder });
            importRatesWithHours.push({ name: "Off-Peak", hours: getHoursFromInput(`${pId}OffPeakHours`), rate: importData.offPeak });
        } else if (pData.importComponent === 'FLAT_RATE_IMPORT') {
            importRatesWithHours.push({ name: "Flat Rate", hours: [], rate: importData.rate });
        }
        const gridCharge = { enabled: document.getElementById(`${pId}GridChargeEnable`)?.checked, startTime: getNumericInput(`${pId}GridChargeStartTime`, 22), endTime: document.getElementById(`${pId}GridChargeEndTime`)?.value.trim() || "Threshold" };
        config.providers[pKey] = { ...pData, dailyCharge: getNumericInput(`${pId}DailyCharge`), rebate: getNumericInput(`${pId}Rebate`), monthlyFee: getNumericInput(`${pId}Membership`), importRates: importRatesWithHours, exportRates: [exportRule], gridCharge: gridCharge, importData: importData, exportData: {} };
        if (pKey === "GloBird") {
            config.providers[pKey].exportData = { bonusRate: getNumericInput(`${pId}SuperExportRate`), bonusLimit: getNumericInput(`${pId}SuperExportLimit`), touRates: [ { name: "4pm-9pm", hours: [16, 17, 18, 19, 20, 21, 22], rate: getNumericInput(`${pId}Export4pm9pmRate`) }, { name: "10am-2pm", hours: [10, 11, 12, 13, 14], rate: getNumericInput(`${pId}Export10am2pmRate`) }, { name: "Other", hours: [], rate: getNumericInput(`${pId}Export9pm10am2pm4pmRate`) } ] };
        } else {
            config.providers[pKey].exportData = exportRule;
        }
    }
    config.initialSystemCost = config.costSolar + config.costBattery;
    if (config.loanEnabled && config.loanAmount > 0 && config.loanInterestRate > 0 && config.loanTerm > 0) {
        const i = config.loanInterestRate / 12; const n = config.loanTerm * 12;
        config.annualLoanRepayment = (config.loanAmount * (i * Math.pow(1 + i, n)) / (Math.pow(1 + i, n) - 1)) * 12;
    } else {
        config.annualLoanRepayment = 0;
    }
    return config;
}