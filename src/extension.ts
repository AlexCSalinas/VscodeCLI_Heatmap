import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Configuration
const DATA_DIR = path.join(os.homedir(), '.vscode-terminal-tracker');
const LOG_FILE = path.join(DATA_DIR, 'terminal-commands.log');
const DATA_FILE = path.join(DATA_DIR, 'heatmap-data.json');
const CMD_FILE = path.join(DATA_DIR, 'cmds.txt');
const SETUP_SCRIPT = path.join(DATA_DIR, 'setup.sh');
const STATUS_BAR_TITLE = '$(terminal) Terminal Tracker';

// Track webview panel
let currentPanel: vscode.WebviewPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Terminal Tracker extension is now active');
    
    // Create directory if needed
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
    // Create the setup script file
    createSetupScript();
    
    // Create status bar item
    const statusBarItem = vscode.window.createStatusBarItem(
        vscode.StatusBarAlignment.Right,
        100
    );
    statusBarItem.text = STATUS_BAR_TITLE;
    statusBarItem.tooltip = 'Click to view your terminal usage heatmap';
    statusBarItem.command = 'terminal-tracker.showHeatmap';
    statusBarItem.show();
    context.subscriptions.push(statusBarItem);
    
    // Register commands
    context.subscriptions.push(
        vscode.commands.registerCommand('terminal-tracker.test', () => {
            vscode.window.showInformationMessage('Test command works!');
        })
    );
    
    context.subscriptions.push(
        vscode.commands.registerCommand('terminal-tracker.showHeatmap', () => {
            console.log("Heatmap command executing");
            
            // Process any pending command files first
            processCommandFiles(statusBarItem);
            
            // Generate the data file
            generateHeatmapData();
            
            // Display the heatmap
            showHeatmapWebview(context);
        })
    );
    
    // Track all terminals at startup
    vscode.window.terminals.forEach(terminal => {
        setupTerminalTracking(terminal);
    });

    // Track new terminals as they're created
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal(terminal => {
            setupTerminalTracking(terminal);
        })
    );
    
    // Update status bar initially
    updateStatusBar(statusBarItem);
    
    // Process any command files more frequently (every 3 seconds)
    setInterval(() => {
        processCommandFiles(statusBarItem);
    }, 3000);
}

// Create the setup script file
function createSetupScript() {
    const scriptContent = `#!/bin/bash
# Terminal Tracker setup script

# Create directory if needed
mkdir -p "${DATA_DIR}"

# Simple tracking function that logs a timestamp when Enter is pressed
log_vscode_cmd() {
    echo "$(date +"%Y-%m-%dT%H:%M:%S%z")" >> "${CMD_FILE}"
}

# Handle different shells
if [ -n "$ZSH_VERSION" ]; then
    # For Zsh
    echo "Setting up for Zsh shell" >> "${DATA_DIR}/setup.log"
    
    # Define the precmd function for Zsh
    precmd() {
        log_vscode_cmd
    }
    
    # Check if it's already in precmd_functions
    if ! typeset -f precmd > /dev/null; then
        # Add a test entry to confirm setup
        echo "$(date +"%Y-%m-%dT%H:%M:%S%z") ZSH-SETUP" >> "${CMD_FILE}"
    fi
    
elif [ -n "$BASH_VERSION" ]; then
    # For Bash
    echo "Setting up for Bash shell" >> "${DATA_DIR}/setup.log"
    
    # Add to PROMPT_COMMAND for Bash
    if [ -z "$PROMPT_COMMAND" ]; then
        export PROMPT_COMMAND="log_vscode_cmd"
    else
        export PROMPT_COMMAND="log_vscode_cmd;$PROMPT_COMMAND"
    fi
    
    # Add a test entry to confirm setup
    echo "$(date +"%Y-%m-%dT%H:%M:%S%z") BASH-SETUP" >> "${CMD_FILE}"
    
else
    # Generic fallback
    echo "Setting up for generic shell" >> "${DATA_DIR}/setup.log"
    
    # Try setting PROMPT_COMMAND as a fallback
    export PROMPT_COMMAND="log_vscode_cmd"
    
    # Add a test entry to confirm setup
    echo "$(date +"%Y-%m-%dT%H:%M:%S%z") GENERIC-SETUP" >> "${CMD_FILE}"
fi

echo "Terminal tracker activated"
`;

    fs.writeFileSync(SETUP_SCRIPT, scriptContent, { mode: 0o755 });
    console.log(`Created setup script at ${SETUP_SCRIPT}`);
}

// Set up terminal tracking by sourcing the script file
function setupTerminalTracking(terminal: vscode.Terminal) {
    console.log(`Setting up tracking for terminal: ${terminal.name}`);
    
    // Simply source our setup script
    terminal.sendText(`source "${SETUP_SCRIPT}"`);
}

// Show the heatmap in a webview
function showHeatmapWebview(context: vscode.ExtensionContext) {
    // Get the path to the HTML file
    const heatmapPath = path.join(context.extensionPath, 'resources', 'heatmap.html');
    console.log(`Looking for heatmap at: ${heatmapPath}`);
    console.log(`File exists: ${fs.existsSync(heatmapPath)}`);
    
    // If panel exists, just reveal it
    if (currentPanel) {
        currentPanel.reveal(vscode.ViewColumn.One);
        return;
    }
    
    // Create new panel
    currentPanel = vscode.window.createWebviewPanel(
        'terminalHeatmap',
        'Terminal Usage Heatmap',
        vscode.ViewColumn.One,
        {
            enableScripts: true,
            localResourceRoots: [vscode.Uri.file(context.extensionPath)]
        }
    );
    
    // Handle messages from the webview
    currentPanel.webview.onDidReceiveMessage(
        async (message) => {
            switch (message.command) {
                case 'loadData':
                    try {
                        // Create a full year of empty data (if no data file exists yet)
                        let data = [];
                        
                        // If the data file exists, load existing data
                        if (fs.existsSync(DATA_FILE)) {
                            const dataContent = fs.readFileSync(DATA_FILE, 'utf8');
                            data = JSON.parse(dataContent);
                        }
                        
                        // Send data to WebView
                        currentPanel?.webview.postMessage({ 
                            command: 'dataLoaded', 
                            data: data 
                        });
                    } catch (error) {
                        console.error('Error loading data:', error);
                        // Send empty data as fallback
                        currentPanel?.webview.postMessage({ 
                            command: 'dataLoaded', 
                            data: [] 
                        });
                    }
                    break;
            }
        }
    );
    
    // Reset when panel is closed
    currentPanel.onDidDispose(
        () => {
            currentPanel = undefined;
        },
        null
    );
    
    // Set the HTML content
    try {
        if (fs.existsSync(heatmapPath)) {
            const htmlContent = fs.readFileSync(heatmapPath, 'utf8');
            currentPanel.webview.html = htmlContent;
        } else {
            console.error(`Heatmap HTML file not found at: ${heatmapPath}`);
            currentPanel.webview.html = `<html><body><h1>Error: HTML file not found at ${heatmapPath}</h1></body></html>`;
            vscode.window.showErrorMessage(`Heatmap HTML file not found at: ${heatmapPath}`);
        }
    } catch (error) {
        console.error('Error loading heatmap HTML:', error);
        vscode.window.showErrorMessage(`Error loading heatmap: ${error}`);
    }
}

// Log a command to the log file
function logCommand(timestamp: string, source: string, action: string) {
    try {
        // Ensure LOG_FILE directory exists
        if (!fs.existsSync(path.dirname(LOG_FILE))) {
            fs.mkdirSync(path.dirname(LOG_FILE), { recursive: true });
        }
        
        // Extract the date part
        const datePart = timestamp.substring(0, 10);
        
        // Create date object and add one day to fix the offset
        const dateObj = new Date(datePart + 'T00:00:00');
        //dateObj.setDate(dateObj.getDate() + 1);
        
        // Format back to YYYY-MM-DD
        const adjustedDatePart = dateObj.getFullYear() + '-' + 
            String(dateObj.getMonth() + 1).padStart(2, '0') + '-' + 
            String(dateObj.getDate()).padStart(2, '0');
        
        // Reconstruct timestamp with adjusted date
        const timeAndZonePart = timestamp.substring(10);
        const adjustedTimestamp = adjustedDatePart + timeAndZonePart;
        
        // Append to log file
        fs.appendFileSync(
            LOG_FILE,
            `${adjustedTimestamp}\t${source}\t${action}\n`
        );
        console.log(`Logged command: ${adjustedTimestamp} ${source} ${action}`);
    } catch (error) {
        console.error('Error logging command:', error);
    }
}

// Generate heatmap data from log file
function generateHeatmapData() {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            vscode.window.showWarningMessage('No terminal command logs found yet.');
            return;
        }
        
        const logData = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = logData.trim().split('\n');
        
        // Map to store command counts by date
        const dateMap: {[key: string]: number} = {};
        
        // Process each log entry
        lines.forEach(line => {
            const parts = line.split('\t');
            if (parts.length >= 1) {
                // Extract date from timestamp (YYYY-MM-DD)
                const date = parts[0].substring(0, 10);
                
                // Create date object from the log date
                const logDateObj = new Date(date + 'T00:00:00');
                
                // Format back to YYYY-MM-DD (no need to adjust here since we already adjusted when logging)
                const adjustedDate = logDateObj.getFullYear() + '-' + 
                    String(logDateObj.getMonth() + 1).padStart(2, '0') + '-' + 
                    String(logDateObj.getDate()).padStart(2, '0');
                
                // Use the adjusted date for counting
                dateMap[adjustedDate] = (dateMap[adjustedDate] || 0) + 1;
            }
        });
        
        // Convert to array format for visualization
        const heatmapData = Object.keys(dateMap).map(date => ({
            date,
            count: dateMap[date]
        }));
        
        // Sort by date
        heatmapData.sort((a, b) => a.date.localeCompare(b.date));
        
        // Write to data file
        fs.writeFileSync(DATA_FILE, JSON.stringify(heatmapData, null, 2));
        
        console.log(`Generated heatmap data with ${heatmapData.length} days of data`);
        
    } catch (error) {
        vscode.window.showErrorMessage(`Error generating heatmap data: ${error}`);
    }
}

// Update status bar with today's count
function updateStatusBar(statusBar: vscode.StatusBarItem) {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            statusBar.text = STATUS_BAR_TITLE + ' (0)';
            return;
        }
        
        const logData = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = logData.trim().split('\n');
        
        // Get today's date in local timezone
        const now = new Date();
        const today = now.getFullYear() + '-' + 
            String(now.getMonth() + 1).padStart(2, '0') + '-' + 
            String(now.getDate()).padStart(2, '0');
        
        // Get tomorrow's date to compare with adjusted logs
        const tomorrow = new Date(now);
        tomorrow.setDate(tomorrow.getDate() + 1);
        const tomorrowStr = tomorrow.getFullYear() + '-' + 
            String(tomorrow.getMonth() + 1).padStart(2, '0') + '-' + 
            String(tomorrow.getDate()).padStart(2, '0');
        
        // Count today's commands
        let todayCount = 0;
        lines.forEach(line => {
            const parts = line.split('\t');
            if (parts.length >= 1) {
                // Extract date from timestamp (YYYY-MM-DD)
                const logDate = parts[0].substring(0, 10);
                
                // Check if this log corresponds to today
                if (logDate === today) {
                    todayCount++;
                }
            }
        });
        
        statusBar.text = `${STATUS_BAR_TITLE} (${todayCount} today)`;
        
    } catch (error) {
        console.error('Error updating command count:', error);
    }
}

// Process command files created by terminal tracking
function processCommandFiles(statusBar: vscode.StatusBarItem) {
    if (fs.existsSync(CMD_FILE)) {
        try {
            const content = fs.readFileSync(CMD_FILE, 'utf8');
            if (!content.trim()) {
                return; // Skip empty files
            }
            
            console.log(`Processing cmd file with ${content.trim().split('\n').length} entries`);
            
            const lines = content.trim().split('\n');
            let processedCount = 0;
            
            // Process each line (each representing an Enter press)
            lines.forEach(line => {
                // Be more lenient with timestamp format
                let timestamp = line.trim();
                let parts;
                
                // Check if this is a setup confirmation with space
                if (timestamp.includes(' SETUP')) {
                    parts = timestamp.split(' ');
                    logCommand(parts[0], 'setup', parts[1] || 'initialization');
                    processedCount++;
                }
                // Check if it matches ISO format with Z (UTC)
                else if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)) {
                    logCommand(timestamp, 'prompt-tracking', 'enter-pressed');
                    processedCount++;
                }
                // Check if it matches ISO format with timezone offset (+/-NNNN)
                else if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/)) {
                    logCommand(timestamp, 'prompt-tracking', 'enter-pressed');
                    processedCount++;
                }
                // Also accept other date formats that just have the date portion
                else if (timestamp.match(/^\d{4}-\d{2}-\d{2}/)) {
                    // Try to standardize the timestamp - use local time instead of UTC
                    const datePart = timestamp.substring(0, 10);
                    const now = new Date();
                    const timeString = now.toTimeString().split(' ')[0]; // HH:MM:SS format
                    const timezoneOffset = now.getTimezoneOffset();
                    const offsetHours = Math.abs(Math.floor(timezoneOffset / 60)).toString().padStart(2, '0');
                    const offsetMinutes = Math.abs(timezoneOffset % 60).toString().padStart(2, '0');
                    const offsetSign = timezoneOffset <= 0 ? '+' : '-';
                    const fullTimestamp = `${datePart}T${timeString}${offsetSign}${offsetHours}${offsetMinutes}`;
                    
                    logCommand(fullTimestamp, 'prompt-tracking', 'enter-pressed');
                    processedCount++;
                }
            });
            
            console.log(`Processed ${processedCount} command entries`);
            
            // Clear the file
            fs.writeFileSync(CMD_FILE, '');
            
            // Update status bar
            updateStatusBar(statusBar);
            
        } catch (error) {
            console.error('Error processing command file:', error);
        }
    } else {
        console.log(`Command file doesn't exist at: ${CMD_FILE}`);
    }
}

export function deactivate() {
    console.log('Terminal Tracker extension deactivated');
}