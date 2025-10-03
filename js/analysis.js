// js/analysis.js
// Version 1.0.6
import { state } from './state.js';
import { getNumericInput, escalate, getRateForHour, parseRangesToHours } from './utils.js';
import { tariffComponents } from './tariffComponents.js';
import { generateHourlyConsumptionProfileFromDailyTOU, generateHourlySolarProfileFromDaily } from './profiles.js';

function calculateAverageSOCAt6am(provider, batteryConfig, simulationData) {
    if (!batteryConfig || batteryConfig.capacity === 0) {
        return 0; // Can't calculate SOC without a battery
    }
    
    let totalAnnualSocKWhDays = 0;
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };

    for (const quarter in simulationData) {
        const qData = simulationData[quarter];
        if (!qData || typeof qData.avgPeak === 'undefined') continue;

        const hourlyConsumption = generateHourlyConsumptionProfileFromDailyTOU(qData.avgPeak, qData.avgShoulder, qData.avgOffPeak);
        
        // Run a simulation for an average day in this season
        // We assume no solar to see the "worst-case" morning SOC after overnight usage.
        const simResults = simulateDay(hourlyConsumption, Array(24).fill(0), provider, batteryConfig);
        
        if (daysPerQuarter[quarter]) {
            // Add the weighted result to the annual total
            totalAnnualSocKWhDays += (simResults.socAt6am || 0) * daysPerQuarter[quarter];
        }
    }
    
    const avgSocKWh = totalAnnualSocKWhDays > 0 ? totalAnnualSocKWhDays / 365 : 0;
    // Convert the average kWh value to a percentage of the battery's capacity
    const avgSocPercent = (avgSocKWh / batteryConfig.capacity) * 100;

    return avgSocPercent;
}

function applySpecialConditions(dailyCost, dailyBreakdown, conditions, dateString) {
    let adjustedCost = dailyCost;
    if (!conditions || conditions.length === 0) {
        return adjustedCost;
    }

    // Get the current month (1-12) from the date string
    const month = parseInt(dateString.split('-')[1], 10);

    // Evaluate each condition in the order provided
    for (const condition of conditions) {
        // If the rule has a 'months' property, check if it applies today
        if (condition.months && condition.months.length > 0 && !condition.months.includes(month)) {
            continue; // Skip this rule if it's not for the current month
        }
        
        let metricValue;
        switch (condition.condition.metric) {
            case 'peak_import':
                metricValue = dailyBreakdown.peakKWh;
                break;
            case 'net_grid_usage':
                const totalImport = dailyBreakdown.peakKWh + dailyBreakdown.shoulderKWh + dailyBreakdown.offPeakKWh;
                const totalExport = dailyBreakdown.tier1ExportKWh + dailyBreakdown.tier2ExportKWh;
                metricValue = totalImport - totalExport;
                break;
            case 'import_in_window':
                const ruleHours = parseRangesToHours(condition.condition.hours || '');
                metricValue = 0;
                for (const h of ruleHours) {
                    metricValue += dailyBreakdown.hourlyImports[h] || 0;
                }
                break;
        }

        let conditionMet = false;
        switch (condition.condition.operator) {
            case 'less_than':
                conditionMet = metricValue < condition.condition.value;
                break;
            case 'less_than_or_equal_to':
                conditionMet = metricValue <= condition.condition.value;
                break;
            case 'greater_than':
                conditionMet = metricValue > condition.condition.value;
                break;
            case 'greater_than_or_equal_to':
                conditionMet = metricValue >= condition.condition.value;
                break;
        }

        if (conditionMet) {
            switch (condition.action.type) {
                case 'flat_credit':
                    adjustedCost -= condition.action.value;
                    break;
                case 'flat_charge':
                    adjustedCost += condition.action.value;
                    break;
            }
        }
    }
    return adjustedCost;
}

function getFitDegradationConfig() {
    return {
        startYear: getNumericInput("fitDegradationStartYear", 1),
        endYear: getNumericInput("fitDegradationEndYear", 10),
        minRate: getNumericInput("fitMinimumRate", 0.03)
    };
}

export function getDegradedFitRate(baseRate, year, fitConfig) {
    if (typeof baseRate !== 'number') return 0;
    const { startYear, endYear, minRate } = fitConfig;
    if (year < startYear || endYear <= startYear) return baseRate;
    if (year >= endYear) return minRate;
    const progress = (year - startYear) / (endYear - startYear);
    return baseRate - (progress * (baseRate - minRate));
}

export function simulateDay(hourlyConsumption, hourlySolar, provider, batteryConfig = null, startingSOC = 0) {
    const results = {
        peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0,
        tier1ExportKWh: 0, tier2ExportKWh: 0,
        gridChargeKWh: 0,
        hourlyImports: Array(24).fill(0),
        hourlyExports: Array(24).fill(0),
        hourlyGridCharge: Array(24).fill(0)
    };
    let batterySOC = startingSOC;
    let socAt6am = 0;

    // Get Peak/Shoulder hours from the new rule-based system
    const peakRule = (provider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
    const shoulderRule = (provider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
    const peakHours = parseRangesToHours(peakRule?.hours || '');
    const shoulderHours = parseRangesToHours(shoulderRule?.hours || '');

    if (!batteryConfig) {
        // --- NO BATTERY SCENARIO ---
        socAt6am = 0;
        for (let h = 0; h < 24; h++) {
            const net = (hourlyConsumption[h] || 0) - (hourlySolar[h] || 0);
            if (net > 0) {
                results.hourlyImports[h] = net;
            } else {
                results.hourlyExports[h] = -net;
            }
        }
    } else {
        // --- WITH BATTERY SCENARIO ---
        for (let h = 0; h < 24; h++) {
            if (h === 6) {
                socAt6am = batterySOC;
            }

            const consumption = hourlyConsumption[h] || 0;
            const solar = hourlySolar[h] || 0;
            const selfConsumption = Math.min(consumption, solar);
            let remainingConsumption = consumption - selfConsumption;
            let excessSolar = solar - selfConsumption;

            if (excessSolar > 0) {
                const chargeFromSolar = Math.min(excessSolar, batteryConfig.capacity - batterySOC, batteryConfig.inverterKW);
                batterySOC += chargeFromSolar;
                excessSolar -= chargeFromSolar;
            }
            results.hourlyExports[h] = excessSolar;

            if (remainingConsumption > 0) {
                const discharge = Math.min(remainingConsumption, batterySOC, batteryConfig.inverterKW);
                batterySOC -= discharge;
                remainingConsumption -= discharge;
            }
            results.hourlyImports[h] = remainingConsumption;

            const startHour = provider.gridChargeStart;
            const endHour = provider.gridChargeEnd;
            let inChargeWindow = (startHour > endHour) ? (h >= startHour || h < endHour) : (h >= startHour && h < endHour);

            if (provider.gridChargeEnabled && inChargeWindow && batterySOC < (batteryConfig.socChargeTrigger / 100) * batteryConfig.capacity) {
                const chargeNeeded = batteryConfig.capacity * (batteryConfig.gridChargeThreshold / 100) - batterySOC;
                const chargeFromGrid = Math.min(chargeNeeded, batteryConfig.inverterKW);
                if (chargeFromGrid > 0) {
                    batterySOC += chargeFromGrid;
                    results.hourlyGridCharge[h] = chargeFromGrid;
                }
            }
        }
    }

    // --- FINAL CATEGORIZATION ---
    // First, categorize the normal (non-grid-charge) home consumption imports.
    for (let h = 0; h < 24; h++) {
        const homeImport = results.hourlyImports[h];
        if (homeImport > 0) {
            if (peakHours.includes(h)) results.peakKWh += homeImport;
            else if (shoulderHours.includes(h)) results.shoulderKWh += homeImport;
            else results.offPeakKWh += homeImport;
        }
    }

    // Now, separately categorize the grid charge imports into the correct TOU buckets for costing.
    for (let h = 0; h < 24; h++) {
        const gridChargeAmount = results.hourlyGridCharge[h];
        if (gridChargeAmount > 0) {
            results.gridChargeKWh += gridChargeAmount; // Accumulate total for the raw data table
            if (peakHours.includes(h)) {
                results.peakKWh += gridChargeAmount;
            } else if (shoulderHours.includes(h)) {
                results.shoulderKWh += gridChargeAmount;
            } else {
                results.offPeakKWh += gridChargeAmount;
            }
        }
    }

    // Tiered export logic
    const dailyTotalExport = results.hourlyExports.reduce((a, b) => a + b, 0);
    const firstExportRule = (provider.exportRules || [])[0];
    if (firstExportRule && firstExportRule.type === 'tiered') {
        results.tier1ExportKWh = Math.min(dailyTotalExport, firstExportRule.limit || Infinity);
        results.tier2ExportKWh = Math.max(0, dailyTotalExport - results.tier1ExportKWh);
    } else {
        results.tier1ExportKWh = dailyTotalExport;
        results.tier2ExportKWh = 0;
    }

    return { dailyBreakdown: results, finalSOC: batterySOC, socAt6am: socAt6am };
}

export function runSimulation(config, simulationData, electricityData) {
    // --- INITIALIZATION ---
    const solarDegradationFactors = Array.from({ length: config.numYears + 1 }, (_, i) => Math.pow(1 - config.solarDegradation, i));
    const batteryDegradationFactors = Array.from({ length: config.numYears + 1 }, (_, i) => Math.pow(1 - config.batteryDegradation, i));
    const fitConfig = getFitDegradationConfig();
    const finalResults = { baselineCosts: {} };
    const rawData = { baseline: { year1: {} }, system: {} };

    const getSeason = (date) => {
        const month = parseInt(date.split('-')[1], 10);
        if ([12, 1, 2].includes(month)) return 'Summer';
        if ([3, 4, 5].includes(month)) return 'Autumn';
        if ([6, 7, 8].includes(month)) return 'Winter';
        return 'Spring';
    };

    config.selectedProviders.forEach(pId => {
        const provider = config.providers.find(p => p.id === pId);
        if (!provider) return;
        finalResults[provider.id] = { annualCosts: [], cumulativeSavingsPerYear: [], npv: 0, roiYear: null };
        rawData.system[provider.id] = { year1: {} };
        for (const q of ['Summer', 'Autumn', 'Winter', 'Spring']) {
            rawData.baseline.year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
            rawData.system[provider.id].year1[q] = { days: 0, peakKWh: 0, shoulderKWh: 0, offPeakKWh: 0, tier1ExportKWh: 0, tier2ExportKWh: 0, gridChargeKWh: 0, gridChargeCost: 0 };
        }
    });

    const baselineProvider = config.providers[0];
    if (!baselineProvider) {
        console.error("Baseline provider not found in config. Cannot run simulation.");
        return { financials: {}, rawData: {}, config: config };
    }

    // --- BASELINE COST CALCULATION (CSV Mode) ---
    let annualizedBaseCost = 0;
    if (!config.useManual && electricityData) {
        let totalCostForPeriod = 0;
        let daysProcessed = 0;
        const importCalculator = tariffComponents.IMPORT_RULES.calculate;
        const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
        
        const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
        const shoulderRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('shoulder'));
        const peakHours = parseRangesToHours(peakRule?.hours || '');
        const shoulderHours = parseRangesToHours(shoulderRule?.hours || '');

        electricityData.forEach(day => {
            daysProcessed++;

            // --- FIX: Directly use the historical data from the CSV ---
            const dailyBreakdown = { 
                peakKWh: 0, 
                shoulderKWh: 0, 
                offPeakKWh: 0, 
                hourlyImports: day.consumption, // Use historical imports directly
                hourlyExports: day.feedIn     // Use historical exports directly
            };

            // Categorize the historical grid imports into TOU bins
            for (let h = 0; h < 24; h++) {
                const gridImport = day.consumption[h] || 0;
                if (peakHours.includes(h)) {
                    dailyBreakdown.peakKWh += gridImport;
                } else if (shoulderHours.includes(h)) {
                    dailyBreakdown.shoulderKWh += gridImport;
                } else {
                    dailyBreakdown.offPeakKWh += gridImport;
                }
            }

            // Record the raw data for the baseline table
            const season = getSeason(day.date);
            const rawSeason = rawData.baseline.year1[season];
            if (rawSeason) {
                rawSeason.days++;
                rawSeason.peakKWh += dailyBreakdown.peakKWh;
                rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh;
                rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh;
                
                const dailyTotalExport = dailyBreakdown.hourlyExports.reduce((a, b) => a + b, 0);
                const firstExportRule = (baselineProvider.exportRules || [])[0];
                if (firstExportRule && firstExportRule.type === 'tiered') {
                    const tier1Amount = Math.min(dailyTotalExport, firstExportRule.limit || Infinity);
                    rawSeason.tier1ExportKWh += tier1Amount;
                    rawSeason.tier2ExportKWh += dailyTotalExport - tier1Amount;
                } else {
                    rawSeason.tier1ExportKWh += dailyTotalExport;
                }
            }
            
            // Calculate cost based on this historically accurate breakdown
            let dailyEnergyCost = importCalculator(baselineProvider.importRules, dailyBreakdown, { rate: 0, year: 1 });
            dailyEnergyCost -= exportCalculator(baselineProvider.exportRules, dailyBreakdown, 1, fitConfig, getDegradedFitRate);
            
            let totalDailyAdjustment = (baselineProvider.dailyCharge || 0) + dailyEnergyCost;
            totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, baselineProvider.specialConditions, day.date);
            totalCostForPeriod += totalDailyAdjustment;
        });

        const annualizationFactor = daysProcessed > 0 ? 365 / daysProcessed : 0;
        annualizedBaseCost = totalCostForPeriod * annualizationFactor;
    }



    // --- MAIN SIMULATION LOOP (BY YEAR) ---
    for (let y = 1; y <= config.numYears; y++) {
        const solarFactor = solarDegradationFactors[y - 1];
        const batteryFactor = batteryDegradationFactors[y - 1];
        const escalationConfig = { rate: config.tariffEscalation, year: y };
        
        if (config.useManual) { /* manual mode logic */ } 
        else {
            finalResults.baselineCosts[y] = escalate(annualizedBaseCost, config.tariffEscalation, y);
        }

        config.selectedProviders.forEach(p => {
            const providerData = config.providers.find(provider => provider.id === p);
            if (!providerData) return;

            let annualCost = 0;
            let totalDaysProcessed = 0;
            let currentSOC = 0;
            
            if (config.useManual) { /* manual mode logic */ } 
            else { // CSV Mode
                const solarDataMap = new Map(state.solarData.map(day => [day.date, day.hourly]));
                const totalSystemKw = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
                const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
                
                electricityData.forEach(day => {
                    totalDaysProcessed++;
                    const hourlySolarRaw = solarDataMap.get(day.date);
                    if (!hourlySolarRaw && !config.noExistingSolar) return;

                    const trueHourlyConsumption = Array(24).fill(0);
                    if (hourlySolarRaw) {
                        for (let h = 0; h < 24; h++) {
                            const gridImport = day.consumption[h] || 0;
                            const gridExport = day.feedIn[h] || 0;
                            const solarGeneration = hourlySolarRaw[h] || 0;
                            const selfConsumed = Math.max(0, solarGeneration - gridExport);
                            trueHourlyConsumption[h] = gridImport + selfConsumed;
                        }
                    } else {
                        for (let h = 0; h < 24; h++) {
                            trueHourlyConsumption[h] = day.consumption[h] || 0;
                        }
                    }

                    let newHourlySolar;
                    if (config.noExistingSolar) {
                        const totalDailySolar = totalSystemKw * config.manualSolarProfile;
                        const month = parseInt(day.date.split('-')[1], 10);
                        const season = getSeason(day.date);
                        newHourlySolar = generateHourlySolarProfileFromDaily(totalDailySolar, season);
                    } else if (hourlySolarRaw) {
                        newHourlySolar = hourlySolarRaw.map(h => (h / solarProfileSourceKw) * totalSystemKw * solarFactor);
                    } else {
                        newHourlySolar = Array(24).fill(0);
                    }

                    const batteryConfig = {
                        capacity: config.newBatteryKWH * batteryFactor,
                        inverterKW: config.newBatteryInverterKW,
                        gridChargeThreshold: config.gridChargeThreshold,
                        socChargeTrigger: config.socChargeTrigger,
                    };
                    
                    const simResults = simulateDay(trueHourlyConsumption, newHourlySolar, providerData, batteryConfig, currentSOC);
                    const dailyBreakdown = simResults.dailyBreakdown;
                    currentSOC = simResults.finalSOC;

                    if (y === 1) {
                        const season = getSeason(day.date);
                        const rawSeason = rawData.system[p].year1[season];
                        if (rawSeason) {
                            rawSeason.days++;
                            rawSeason.peakKWh += dailyBreakdown.peakKWh;
                            rawSeason.shoulderKWh += dailyBreakdown.shoulderKWh;
                            rawSeason.offPeakKWh += dailyBreakdown.offPeakKWh;
                            rawSeason.tier1ExportKWh += dailyBreakdown.tier1ExportKWh;
                            rawSeason.tier2ExportKWh += dailyBreakdown.tier2ExportKWh;
                            rawSeason.gridChargeKWh += dailyBreakdown.gridChargeKWh;
                            rawSeason.gridChargeCost += dailyBreakdown.gridChargeCost;
                        }
                    }

                    const importCalculator = tariffComponents.IMPORT_RULES.calculate;
                    const exportCalculator = tariffComponents.EXPORT_RULES.calculate;
                    
                    let dailyEnergyCost = dailyBreakdown.gridChargeCost || 0;
                    dailyEnergyCost += importCalculator(providerData.importRules, dailyBreakdown, escalationConfig);
                    dailyEnergyCost -= exportCalculator(providerData.exportRules, dailyBreakdown, y, fitConfig, getDegradedFitRate);
                    
                    let totalDailyAdjustment = escalate((providerData.dailyCharge || 0), config.tariffEscalation, y) + dailyEnergyCost;
                    totalDailyAdjustment = applySpecialConditions(totalDailyAdjustment, dailyBreakdown, providerData.specialConditions, day.date);
                    annualCost += totalDailyAdjustment;
                });

                const annualizationFactor = totalDaysProcessed > 0 ? 365 / totalDaysProcessed : 0;
                annualCost = annualCost * annualizationFactor;
            }

            const finalAnnualCost = annualCost + escalate((providerData.monthlyFee || 0) * 12, config.tariffEscalation, y);
            finalResults[p].annualCosts.push(finalAnnualCost);
            
            const annualSavings = finalResults.baselineCosts[y] - finalAnnualCost;
            const systemCostForProvider = config.initialSystemCost - (providerData.rebate || 0);
            
            const netCashFlow = annualSavings - (y <= config.loanTerm ? config.annualLoanRepayment : 0);
            const lastYearCumulative = finalResults[p].cumulativeSavingsPerYear[y - 2] || 0;
            const currentCumulative = lastYearCumulative + netCashFlow;
            finalResults[p].cumulativeSavingsPerYear.push(currentCumulative);
            
            if (!finalResults[p].roiYear && currentCumulative >= systemCostForProvider) {
                finalResults[p].roiYear = y;
            }

            if (config.discountRateEnabled) {
                finalResults[p].npv += netCashFlow / Math.pow(1 + config.discountRate, y);
            }
        });
    }
    return { financials: finalResults, rawData: rawData, config: config };
}

export function calculateSizingRecommendations(coverageTarget, simulationData) {
    if (!simulationData || Object.keys(simulationData).length === 0) {
        return { solar: 0, battery: 0, inverter: 0, coverageTarget: coverageTarget };
    }
    const daysPerQuarter = { 'Q1_Summer': 90, 'Q2_Autumn': 91, 'Q3_Winter': 92, 'Q4_Spring': 92 };
    let totalKWh = 0, totalEveningKWh = 0, totalDays = 0;
    for (const quarter in simulationData) {
        if(simulationData[quarter]){
            const q = simulationData[quarter];
            const daysInQ = daysPerQuarter[quarter];
            if (daysInQ) {
                totalKWh += (q.avgPeak + q.avgShoulder + q.avgOffPeak) * daysInQ;
                // --- FIX: Improved heuristic for "evening" consumption ---
                // We now take all of peak, but only half of off-peak as a better guess for
                // consumption during non-solar hours (evening + overnight).
                totalEveningKWh += (q.avgPeak + (q.avgOffPeak * 0.5)) * daysInQ;
                totalDays += daysInQ;
            }
        }
    }
    
    let avgDailyGenerationPerKW = 4.0; 
    const existingKW = getNumericInput('existingSolarKW');
    if (state.solarData && state.solarData.length > 0 && existingKW > 0) {
        const totalGeneration = state.solarData.reduce((acc, day) => acc + day.hourly.reduce((a, b) => a + b, 0), 0);
        const avgDailyGeneration = totalGeneration / state.solarData.length;
        avgDailyGenerationPerKW = avgDailyGeneration / existingKW;
    }
    
    const avgDailyConsumption = totalDays > 0 ? totalKWh / totalDays : 0;
    const totalAnnualKWh = avgDailyConsumption * 365;
    const avgDailyEveningConsumption = totalDays > 0 ? totalEveningKWh / totalDays : 0;
    const targetAnnualGeneration = totalAnnualKWh * (coverageTarget / 100);
    let recommendedSolarKW = (avgDailyGenerationPerKW > 0) ? targetAnnualGeneration / (avgDailyGenerationPerKW * 365) : 0;
    recommendedSolarKW = Math.round(recommendedSolarKW * 2) / 2;
    
    // The rest of the logic is fine
    const scalingFactor = coverageTarget / 90;
    const targetEveningConsumption = avgDailyEveningConsumption * scalingFactor;
    let recommendedBatteryKWh;
    if (targetEveningConsumption <= 5) recommendedBatteryKWh = 5;
    else if (targetEveningConsumption <= 10) recommendedBatteryKWh = 10;
    else if (targetEveningConsumption <= 13.5) recommendedBatteryKWh = 13.5;
    else recommendedBatteryKWh = Math.round(targetEveningConsumption);
    let recommendedInverterKW;
    if (recommendedSolarKW <= 6.6) recommendedInverterKW = 5;
    else if (recommendedSolarKW <= 10) recommendedInverterKW = 8;
    else recommendedInverterKW = 10;
    
    return { solar: recommendedSolarKW, battery: recommendedBatteryKWh, inverter: recommendedInverterKW, coverageTarget: coverageTarget };
}

export function calculateDetailedSizing(correctedElectricityData, solarData, config, simulationData) {
    if (!correctedElectricityData) return null;

    const baselineProvider = config.providers.find(p => p.id === config.selectedProviders[0]);
    let peakHours = [];
    if (baselineProvider) {
        const peakRule = (baselineProvider.importRules || []).find(r => r.name.toLowerCase().includes('peak'));
        peakHours = parseRangesToHours(peakRule?.hours || '');
    }

    const totalSolarKW = config.replaceExistingSystem ? config.newSolarKW : config.existingSolarKW + config.newSolarKW;
    const solarProfileSourceKw = config.existingSolarKW > 0 ? config.existingSolarKW : 1;
    const solarDataMap = config.noExistingSolar ? new Map() : new Map((solarData || []).map(day => [day.date, day.hourly]));
    
    const dailyPeakPeriodData = [];
    const dailyMaxHourData = [];
    let totalDays = 0;

    correctedElectricityData.forEach(day => {
        totalDays++;
        let dailyPeakPeriodKWh = 0;
        let dailyMaxHourKWh = 0;
        
        let hourlySolar;
        if (config.noExistingSolar) {
            const totalDailySolar = totalSolarKW * config.manualSolarProfile;
            const month = parseInt(day.date.split('-')[1], 10);
            const season = [12,1,2].includes(month) ? 'Q1_Summer' : [3,4,5].includes(month) ? 'Q2_Autumn' : [6,7,8].includes(month) ? 'Q3_Winter' : 'Q4_Spring';
            hourlySolar = generateHourlySolarProfileFromDaily(totalDailySolar, season);
        } else {
            const hourlySolarRaw = solarDataMap.get(day.date) || Array(24).fill(0);
            hourlySolar = hourlySolarRaw.map(h => (h / solarProfileSourceKw) * totalSolarKW);
        }

        for (let h = 0; h < 24; h++) {
            const consumption = day.consumption[h] || 0;
            const solar = hourlySolar[h] || 0;
            const selfConsumption = Math.min(consumption, solar);
            const remainingConsumption = consumption - selfConsumption;
            dailyMaxHourKWh = Math.max(dailyMaxHourKWh, remainingConsumption);
            
            if (peakHours.includes(h)) {
                dailyPeakPeriodKWh += consumption;
            }
        }
        dailyPeakPeriodData.push(dailyPeakPeriodKWh);
        dailyMaxHourData.push(dailyMaxHourKWh);
    });

    if (totalDays === 0) return null;

    const getPercentile = (data, percentile) => {
        const sortedData = [...data].sort((a, b) => a - b);
        const index = Math.ceil(percentile * sortedData.length) - 1;
        return sortedData[Math.max(0, index)];
    };

    const recommendedBatteryKWh = getPercentile(dailyPeakPeriodData, 0.90);
    const recommendedInverterKW = getPercentile(dailyMaxHourData, 0.90);
    const finalBatteryRec = Math.ceil(recommendedBatteryKWh);
    const finalInverterRec = (Math.ceil(recommendedInverterKW * 2) / 2);
    const batteryCoverageDays = dailyPeakPeriodData.filter(d => d <= finalBatteryRec).length;
    const inverterCoverageDays = dailyMaxHourData.filter(d => d <= finalInverterRec).length;
    
    const heuristicRecs = calculateSizingRecommendations(config.recommendationCoverageTarget, simulationData);

    let blackoutResults = null;
    if (config.blackoutSizingEnabled && config.blackoutDuration > 0 && config.blackoutCoverage > 0) {
        const allHours = correctedElectricityData.flatMap(d => d.consumption);
        let maxConsumptionInWindow = 0;
        for (let i = 0; i <= allHours.length - config.blackoutDuration; i++) {
            const windowSum = allHours.slice(i, i + config.blackoutDuration).reduce((a, b) => a + b, 0);
            if (windowSum > maxConsumptionInWindow) maxConsumptionInWindow = windowSum;
        }
        const requiredReserve = maxConsumptionInWindow * config.blackoutCoverage;
        const totalCalculatedSize = finalBatteryRec + requiredReserve;
        const standardSizes = [5, 10, 13.5, 16, 20, 24, 32, 40, 48];
        const practicalSize = standardSizes.find(size => size >= totalCalculatedSize) || Math.ceil(totalCalculatedSize);
        blackoutResults = { requiredReserve, totalCalculatedSize, practicalSize };
    }

    return {
        heuristic: heuristicRecs,
        detailed: {
            recommendedBatteryKWh: finalBatteryRec,
            recommendedInverterKW: finalInverterRec,
            batteryCoverageDays: batteryCoverageDays,
            inverterCoverageDays: inverterCoverageDays,
            totalDays: totalDays,
        },
        distributions: {
            peakPeriod: dailyPeakPeriodData,
            maxHourly: dailyMaxHourData,
        },
        blackout: blackoutResults
    };
}