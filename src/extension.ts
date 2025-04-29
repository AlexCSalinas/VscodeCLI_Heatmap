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
        let dataChanged = processCommandFiles(statusBarItem);
        
        // If data changed and webview is open, update it real-time
        if (dataChanged && currentPanel) {
            generateHeatmapData();
            updateHeatmapWebviewRealtime();
        }
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
    local exit_status=$?
    echo "$(date +"%Y-%m-%dT%H:%M:%S%z")|$exit_status" >> "${CMD_FILE}"
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
        echo "$(date +"%Y-%m-%dT%H:%M:%S%z")|0 ZSH-SETUP" >> "${CMD_FILE}"
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
    echo "$(date +"%Y-%m-%dT%H:%M:%S%z")|0 BASH-SETUP" >> "${CMD_FILE}"
    
else
    # Generic fallback
    echo "Setting up for generic shell" >> "${DATA_DIR}/setup.log"
    
    # Try setting PROMPT_COMMAND as a fallback
    export PROMPT_COMMAND="log_vscode_cmd"
    
    # Add a test entry to confirm setup
    echo "$(date +"%Y-%m-%dT%H:%M:%S%z")|0 GENERIC-SETUP" >> "${CMD_FILE}"
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
                        
                        // Also send today's statistics
                        const todayStats = getTodayStatistics();
                        currentPanel?.webview.postMessage({
                            command: 'todayStats',
                            data: todayStats
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

// Get today's command statistics
function getTodayStatistics() {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            return {
                total: 0,
                success: 0,
                failure: 0,
                successRate: 100
            };
        }
        
        const logData = fs.readFileSync(LOG_FILE, 'utf8');
        const lines = logData.trim().split('\n');
        
        // Get today's date in local timezone
        const now = new Date();
        const today = now.getFullYear() + '-' + 
            String(now.getMonth() + 1).padStart(2, '0') + '-' + 
            String(now.getDate()).padStart(2, '0');
        
        // Count today's commands and success/failure
        let todayCount = 0;
        let todaySuccessCount = 0;
        let todayFailureCount = 0;
        
        lines.forEach(line => {
            const parts = line.split('\t');
            if (parts.length >= 1) {
                // Extract date from timestamp (YYYY-MM-DD)
                const logDate = parts[0].substring(0, 10);
                
                // Check if this log corresponds to today
                if (logDate === today) {
                    todayCount++;
                    
                    // Check exit status
                    const exitStatusMatch = line.match(/exit=(\d+)/);
                    if (exitStatusMatch) {
                        if (exitStatusMatch[1] === '0') {
                            todaySuccessCount++;
                        } else {
                            todayFailureCount++;
                        }
                    }
                }
            }
        });
        
        // Calculate success rate
        const successRate = todayCount > 0 ? 
            Math.round((todaySuccessCount / todayCount) * 100) : 100;
        
        return {
            total: todayCount,
            success: todaySuccessCount,
            failure: todayFailureCount,
            successRate: successRate,
            date: today
        };
        
    } catch (error) {
        console.error('Error getting today statistics:', error);
        return {
            total: 0,
            success: 0,
            failure: 0,
            successRate: 100
        };
    }
}

// Update webview in real-time with new data
function updateHeatmapWebviewRealtime() {
    try {
        if (!currentPanel) return;
        
        // Load the latest data
        if (fs.existsSync(DATA_FILE)) {
            const dataContent = fs.readFileSync(DATA_FILE, 'utf8');
            const data = JSON.parse(dataContent);
            
            // Send updated data to the webview
            currentPanel.webview.postMessage({
                command: 'dataUpdated',
                data: data
            });
            
            // Also send today's updated statistics
            const todayStats = getTodayStatistics();
            currentPanel.webview.postMessage({
                command: 'todayStats',
                data: todayStats
            });
        }
    } catch (error) {
        console.error('Error updating heatmap webview:', error);
    }
}

// Log a command to the log file
function logCommand(timestamp: string, source: string, action: string, exitStatus: string = '0') {
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
            `${adjustedTimestamp}\t${source}\t${action}\texit=${exitStatus}\n`
        );
        console.log(`Logged command: ${adjustedTimestamp} ${source} ${action} exit=${exitStatus}`);
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
        
        // Maps to store command counts by date
        const dateMap: {[key: string]: number} = {};
        const successMap: {[key: string]: number} = {};
        const failureMap: {[key: string]: number} = {};
        
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
                
                // Check exit status if available
                const exitStatusMatch = line.match(/exit=(\d+)/);
                if (exitStatusMatch) {
                    const exitStatus = exitStatusMatch[1];
                    if (exitStatus === '0') {
                        // Success
                        successMap[adjustedDate] = (successMap[adjustedDate] || 0) + 1;
                    } else {
                        // Failure
                        failureMap[adjustedDate] = (failureMap[adjustedDate] || 0) + 1;
                    }
                }
            }
        });
        
        // Convert to array format for visualization
        const heatmapData = Object.keys(dateMap).map(date => ({
            date,
            count: dateMap[date],
            success: successMap[date] || 0,
            failure: failureMap[date] || 0,
            successRate: successMap[date] ? 
                Math.round((successMap[date] / (successMap[date] + (failureMap[date] || 0))) * 100) : 
                100
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
        const todayStats = getTodayStatistics();
        
        // Format the status bar text with today's count and success rate
        statusBar.text = `${STATUS_BAR_TITLE} (${todayStats.total} today, ${todayStats.successRate}% success)`;
    } catch (error) {
        console.error('Error updating command count:', error);
        statusBar.text = STATUS_BAR_TITLE + ' (0)';
    }
}

// Process command files created by terminal tracking
// Returns true if new commands were processed
function processCommandFiles(statusBar: vscode.StatusBarItem): boolean {
    if (fs.existsSync(CMD_FILE)) {
        try {
            const content = fs.readFileSync(CMD_FILE, 'utf8');
            if (!content.trim()) {
                return false; // Skip empty files
            }
            
            console.log(`Processing cmd file with ${content.trim().split('\n').length} entries`);
            
            const lines = content.trim().split('\n');
            let processedCount = 0;
            
            // Process each line (each representing an Enter press)
            lines.forEach(line => {
                // Be more lenient with timestamp format
                let timestamp = line.trim();
                let parts;
                let exitStatus = '0'; // Default to success
                
                // Extract exit status if present
                if (timestamp.includes('|')) {
                    parts = timestamp.split('|');
                    timestamp = parts[0];
                    exitStatus = parts[1];
                    
                    // If there's a space after the exit status (for setup logs)
                    if (exitStatus.includes(' ')) {
                        const setupParts = exitStatus.split(' ');
                        exitStatus = setupParts[0];
                        const setupType = setupParts[1] || 'initialization';
                        
                        logCommand(timestamp, 'setup', setupType, exitStatus);
                        processedCount++;
                        return; // Skip further processing for setup entries
                    }
                }
                
                // Check if it matches ISO format with Z (UTC)
                if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)) {
                    logCommand(timestamp, 'prompt-tracking', 'enter-pressed', exitStatus);
                    processedCount++;
                }
                // Check if it matches ISO format with timezone offset (+/-NNNN)
                else if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}[+-]\d{4}$/)) {
                    logCommand(timestamp, 'prompt-tracking', 'enter-pressed', exitStatus);
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
                    
                    logCommand(fullTimestamp, 'prompt-tracking', 'enter-pressed', exitStatus);
                    processedCount++;
                }
            });
            
            console.log(`Processed ${processedCount} command entries`);
            
            // Clear the file
            fs.writeFileSync(CMD_FILE, '');
            
            // Update status bar
            updateStatusBar(statusBar);
            
            return processedCount > 0;
            
        } catch (error) {
            console.error('Error processing command file:', error);
            return false;
        }
    } else {
        console.log(`Command file doesn't exist at: ${CMD_FILE}`);
        return false;
    }
}

export function deactivate() {
    console.log('Terminal Tracker extension deactivated');
}