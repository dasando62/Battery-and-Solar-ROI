// js/storage.js
//Version 9.5
import { downloadBlob } from './utils.js';

const savableInputIds = [
  "dailyPeak", "dailyShoulder", "dailyOffPeak", "dailySolar", "existingSolarKW", "existingSolarInverter",
  "existingBattery", "existingBatteryInverter", "newSolarKW", "costSolar", "newBattery", "newBatteryInverter",
  "costBattery", "gridOffPeakCharge", "gridChargeThreshold", "gridChargeStartTime", "enableBlackoutSizing",
  "blackoutDuration", "blackoutCoverage", "enableLoan", "loanAmount", "loanInterestRate", "loanTerm",
  "enableDiscountRate", "discountRate", "tariffEscalation", "fitDegradationStartYear", "fitDegradationEndYear",
  "fitMinimumRate", "originDailyCharge", "originPeakRate", "originShoulderRate", "originOffPeakRate",
  "originExport1Rate", "originExport1Limit", "originExport2Rate", "originRebate", // <-- ADD THIS
  "globirdDailyCharge", "globirdPeakRate", "globirdShoulderRate", "globirdOffPeakRate",
  "globirdExport4pm9pmRate", "globirdExport9pm10am2pm4pmRate", "globirdExport10am2pmRate",
  "globirdSuperExportRate", "globirdSuperExportLimit", "globirdZeroHeroCredit", "globirdRebate", // <-- ADD THIS
  "amberDailyCharge", "amberImportRate", "amberExportRate", "amberMembership", "amberRebate", // <-- ADD THIS
  "aglDailyCharge", "aglPeakRate", "aglShoulderRate", "aglOffPeakRate", "aglExportRate", "aglRebate", // <-- ADD THIS
  "numYears", "solarDegradation", "batteryDegradation",
  "noExistingSolar", "manualInputToggle", "debugToggle"
]
export function saveSettingsToFile() {
  const settings = {};
  savableInputIds.forEach(id => {
    const element = document.getElementById(id);
    if (element) {
      settings[id] = element.type === 'checkbox' ? element.checked : element.value;
    }
  });
  downloadBlob('roi_settings.json', JSON.stringify(settings, null, 2), 'application/json');
}

export function wireLoadSettings(inputFileElementId) {
    const input = document.getElementById(inputFileElementId);
    if (!input) return;

    input.addEventListener('change', (event) => {
        const file = event.target.files[0];
        const statusDiv = document.getElementById('settingsFileStatus');

        if (!file) {
            if (statusDiv) {
                statusDiv.textContent = "";
                statusDiv.classList.remove('loaded');
            }
            return;
        }

        const reader = new FileReader();
        reader.onload = (e) => {
            try {
                const settings = JSON.parse(e.target.result);
                
                // --- START OF CHANGES ---

                // 1. Count the number of items in the loaded settings object
                const itemCount = Object.keys(settings).length;

                // 2. Apply the settings (this loop remains the same)
                for (const id in settings) {
                    const el = document.getElementById(id);
                    if (el) {
                        if (el.type === 'checkbox') {
                            el.checked = settings[id];
                            el.dispatchEvent(new Event('change'));
                        } else {
                            el.value = settings[id];
                        }
                    }
                }
                // 3. Update the status text with the new message
                if (statusDiv) {
                    statusDiv.textContent = `${itemCount} configuration items loaded`;
                    statusDiv.classList.add('loaded');
                }
                
                // --- END OF CHANGES ---

            } catch (error) {
                if (statusDiv) {
                    statusDiv.textContent = "Load failed. Invalid file.";
                    statusDiv.classList.add('loaded');
                }
                console.error("Error loading settings:", error);
            }
        };
        reader.readAsText(file);
    });
}

export function wireSaveSettings(buttonElementId) {
    const button = document.getElementById(buttonElementId);
    if (!button) return;

    button.addEventListener('click', () => {
        const settings = {};
        // List of all input IDs to save
        const inputIds = [
            // Data Input
            "manualSolarProfile", "summerDailyPeak", "summerDailyShoulder", "summerDailyOffPeak", "summerDailySolar",
            "autumnDailyPeak", "autumnDailyShoulder", "autumnDailyOffPeak", "autumnDailySolar",
            "winterDailyPeak", "winterDailyShoulder", "winterDailyOffPeak", "winterDailySolar",
            "springDailyPeak", "springDailyShoulder", "springDailyOffPeak", "springDailySolar",
            // Existing System
            "existingSolarKW", "existingSolarInverter", "existingBattery", "existingBatteryInverter",
            // New System
            "newSolarKW", "costSolar", "newBattery", "newBatteryInverter", "costBattery", "gridChargeThreshold",
            "recommendationCoverageTarget",
            // Financial Inputs
            "loanAmount", "loanInterestRate", "loanTerm", "discountRate",
            // Providers & Tariffs
            "tariffEscalation", "fitDegradationStartYear", "fitDegradationEndYear", "fitMinimumRate",
            "originRebate", "originDailyCharge", "originPeakHours", "originShoulderHours", "originOffPeakHours",
            "originPeakRate", "originShoulderRate", "originOffPeakRate", "originExport1Rate", "originExport1Limit", "originExport2Rate",
            "originGridChargeEnable", "originGridChargeStartTime", "originGridChargeEndTime",
            "globirdRebate", "globirdDailyCharge", "globirdPeakHours", "globirdShoulderHours", "globirdOffPeakHours",
            "globirdPeakRate", "globirdShoulderRate", "globirdOffPeakRate", "globirdExport4pm9pmRate",
            "globirdExport9pm10am2pm4pmRate", "globirdExport10am2pmRate", "globirdSuperExportRate", "globirdSuperExportLimit", "globirdZeroHeroCredit",
            "globirdGridChargeEnable", "globirdGridChargeStartTime", "globirdGridChargeEndTime",
            "amberRebate", "amberDailyCharge", "amberImportRate", "amberExportRate", "amberMembership",
            "amberGridChargeEnable", "amberGridChargeStartTime", "amberGridChargeEndTime",
            "aglRebate", "aglDailyCharge", "aglPeakHours", "aglShoulderHours", "aglOffPeakHours",
            "aglPeakRate", "aglShoulderRate", "aglOffPeakRate", "aglExportRate",
            "aglGridChargeEnable", "aglGridChargeStartTime", "aglGridChargeEndTime",
            // Analysis Period
            "numYears", "solarDegradation", "batteryDegradation"
        ];
        
        // Checkboxes that need their 'checked' state saved
        const checkboxIds = [
            "noExistingSolar", "manualInputToggle", "debugToggle", "replaceExistingSystem",
            "enableBlackoutSizing", "enableLoan", "enableDiscountRate",
            "originGridChargeEnable", "globirdGridChargeEnable", "amberGridChargeEnable", "aglGridChargeEnable"
        ];

        // Gather values from regular inputs
        inputIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) settings[id] = el.value;
        });

        // Gather state from checkboxes
        checkboxIds.forEach(id => {
            const el = document.getElementById(id);
            if (el) settings[id] = el.checked;
        });

        // Create and download the file
        const settingsString = JSON.stringify(settings, null, 2);
        const blob = new Blob([settingsString], { type: 'application/json' });
        const url = URL.createObjectURL(blob);
        const a = document.createElement('a');
        a.href = url;
        a.download = 'roi_settings.json';
        document.body.appendChild(a);
        a.click();
        document.body.removeChild(a);
        URL.revokeObjectURL(url);
    });
}