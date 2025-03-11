import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Configuration
const DATA_DIR = path.join(os.homedir(), '.vscode-terminal-tracker');
const LOG_FILE = path.join(DATA_DIR, 'terminal-commands.log');
const DATA_FILE = path.join(DATA_DIR, 'heatmap-data.json');
const CMD_FILE = path.join(DATA_DIR, 'cmds.txt');
const STATUS_BAR_TITLE = '$(terminal) Terminal Tracker';

// Track webview panel
let currentPanel: vscode.WebviewPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Terminal Tracker extension is now active');
    
    // Create directory if needed
    if (!fs.existsSync(DATA_DIR)) {
        fs.mkdirSync(DATA_DIR, { recursive: true });
    }
    
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
            
            // Show confirmation
            vscode.window.showInformationMessage('Terminal usage heatmap generated!');
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
    
    // Process any command files periodically (every 10 seconds)
    setInterval(() => {
        processCommandFiles(statusBarItem);
    }, 10000);
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
                        if (fs.existsSync(DATA_FILE)) {
                            const dataContent = fs.readFileSync(DATA_FILE, 'utf8');
                            const data = JSON.parse(dataContent);
                            currentPanel?.webview.postMessage({ 
                                command: 'dataLoaded', 
                                data: data 
                            });
                        } else {
                            currentPanel?.webview.postMessage({ 
                                command: 'dataLoaded', 
                                data: [] 
                            });
                        }
                    } catch (error) {
                        console.error('Error loading data:', error);
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
        fs.appendFileSync(
            LOG_FILE,
            `${timestamp}\t${source}\t${action}\n`
        );
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
                // Extract date from ISO timestamp (YYYY-MM-DD)
                const date = parts[0].substring(0, 10);
                dateMap[date] = (dateMap[date] || 0) + 1;
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
        
        // Get today's date
        const today = new Date().toISOString().substring(0, 10);
        
        // Count today's commands
        let todayCount = 0;
        lines.forEach(line => {
            const parts = line.split('\t');
            if (parts.length >= 1 && parts[0].startsWith(today)) {
                todayCount++;
            }
        });
        
        statusBar.text = `${STATUS_BAR_TITLE} (${todayCount} today)`;
        
    } catch (error) {
        console.error('Error updating command count:', error);
    }
}

// Set up terminal tracking via PROMPT_COMMAND
function setupTerminalTracking(terminal: vscode.Terminal) {
    console.log(`Setting up tracking for terminal: ${terminal.name}`);
    
    if (terminal.name.toLowerCase().includes('bash') || 
        terminal.name.toLowerCase().includes('zsh') ||
        terminal.name.toLowerCase().includes('terminal')) {
        
        // Send command to set up PROMPT_COMMAND for tracking
        terminal.sendText(`
# Terminal Tracker initialization
if [[ -z \${TERMINAL_TRACKER_INIT+x} ]]; then
    export TERMINAL_TRACKER_INIT=1
    mkdir -p "${DATA_DIR}"
    
    # Simple tracking function - logs timestamp each time Enter is pressed
    log_vscode_cmd() {
        echo "$(date -u +"%Y-%m-%dT%H:%M:%SZ")" >> "${DATA_DIR}/cmds.txt"
    }
    
    # Ensure PROMPT_COMMAND executes our function
    if [[ -z "\${PROMPT_COMMAND}" ]]; then
        export PROMPT_COMMAND="log_vscode_cmd"
    else
        export PROMPT_COMMAND="log_vscode_cmd;\${PROMPT_COMMAND}"
    fi
    
    echo "Terminal tracker activated"
fi`, true);
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
            
            const lines = content.trim().split('\n');
            
            // Process each line (each representing an Enter press)
            lines.forEach(timestamp => {
                // Validate timestamp format
                if (timestamp.match(/^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}Z$/)) {
                    // Log each timestamp as an "enter-pressed" event
                    logCommand(timestamp, 'prompt-tracking', 'enter-pressed');
                }
            });
            
            // Clear the file
            fs.writeFileSync(CMD_FILE, '');
            
            // Update status bar
            updateStatusBar(statusBar);
            
        } catch (error) {
            console.error('Error processing command file:', error);
        }
    }
}

export function deactivate() {
    console.log('Terminal Tracker extension deactivated');
}