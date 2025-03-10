import * as vscode from 'vscode';
import * as fs from 'fs';
import * as path from 'path';
import * as os from 'os';

// Configuration
const LOG_DIR = path.join(os.homedir(), '.vscode-terminal-tracker');
const LOG_FILE = path.join(LOG_DIR, 'terminal-commands.log');
const DATA_FILE = path.join(LOG_DIR, 'heatmap-data.json');
const STATUS_BAR_TITLE = '$(terminal) Terminal Tracker';

// Track webview panel
let currentPanel: vscode.WebviewPanel | undefined = undefined;

export function activate(context: vscode.ExtensionContext) {
    console.log('Terminal Tracker extension is now active');
    
    // Create log directory if it doesn't exist
    if (!fs.existsSync(LOG_DIR)) {
        fs.mkdirSync(LOG_DIR, { recursive: true });
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
    
    // Track commands executed in the terminal
    // Track when a terminal is created
    context.subscriptions.push(
        vscode.window.onDidOpenTerminal(terminal => {
            console.log(`Terminal opened: ${terminal.name}`);
            trackTerminal(terminal);
            
            // Log terminal creation
            logCommand(`[Terminal opened: ${terminal.name}]`);
            updateCommandCountDisplay(statusBarItem);
        })
    );
    
    // Track already open terminals
    vscode.window.terminals.forEach(terminal => {
        console.log(`Tracking existing terminal: ${terminal.name}`);
        trackTerminal(terminal);
    });
    
    // Track when text is sent to the terminal
    context.subscriptions.push(
        ((vscode.window as any).onDidWriteTerminalData)((e: any)=> {
            // This can be noisy, but helps detect terminal activity
            // Detect command executions by looking for common patterns
            const data = e.data;
            if (data.includes('\n') || data.includes('\r')) {
                // Possible command execution
                logCommand(`[Terminal activity in: ${e.terminal.name}]`);
                updateCommandCountDisplay(statusBarItem);
            }
        })
    );
    
    // Register command to show heatmap
    context.subscriptions.push(
        vscode.commands.registerCommand('terminal-tracker.showHeatmap', () => {
            generateHeatmapData();
            
            // Create and show webview panel
            if (currentPanel) {
                // If we already have a panel, reveal it
                currentPanel.reveal(vscode.ViewColumn.One);
            } else {
                // Create a new panel
                currentPanel = vscode.window.createWebviewPanel(
                    'terminalHeatmap',
                    'Terminal Usage Heatmap',
                    vscode.ViewColumn.One,
                    {
                        // Enable JavaScript in the webview
                        enableScripts: true,
                        // Restrict the webview to only load resources from the extension's directory
                        localResourceRoots: [vscode.Uri.file(context.extensionPath)]
                    }
                );
                
                // Handle messages from the webview
                currentPanel.webview.onDidReceiveMessage(
                    async (message) => {
                        switch (message.command) {
                            case 'getHomeDir':
                                currentPanel?.webview.postMessage({ 
                                    command: 'homeDir', 
                                    path: os.homedir() 
                                });
                                break;
                            case 'loadData':
                                try {
                                    // Read data file
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
                    },
                    undefined,
                    context.subscriptions
                );
                
                // Reset when the panel is disposed
                currentPanel.onDidDispose(
                    () => {
                        currentPanel = undefined;
                    },
                    null,
                    context.subscriptions
                );
            }
            
            // Set the HTML content
            const htmlPath = path.join(context.extensionPath, 'resources', 'heatmap.html');
            try {
                if (fs.existsSync(htmlPath)) {
                    const htmlContent = fs.readFileSync(htmlPath, 'utf8');
                    currentPanel.webview.html = htmlContent;
                } else {
                    console.error(`Heatmap HTML file not found at: ${htmlPath}`);
                    currentPanel.webview.html = getErrorHTML(`HTML file not found at ${htmlPath}`);
                    vscode.window.showErrorMessage(`Heatmap HTML file not found at: ${htmlPath}`);
                }
            } catch (error) {
                console.error('Error loading heatmap HTML:', error);
                currentPanel.webview.html = getErrorHTML(`Error loading heatmap: ${error}`);
                vscode.window.showErrorMessage(`Error loading heatmap: ${error}`);
            }
            
            // Show confirmation message
            vscode.window.showInformationMessage('Terminal usage heatmap generated and opened!');
        })
    );
    
    // Monitor terminal commands through Execution event if available in API
    if ('onDidWriteTerminalData' in vscode.window) {
        console.log('Using onDidWriteTerminalData API for command tracking');
    }
    
    // Use the new API if available
    if ('onDidExecuteTerminalCommand' in vscode.window) {
        console.log('Using onDidExecuteTerminalCommand API for command tracking');
        context.subscriptions.push(
            (vscode.window as any).onDidExecuteTerminalCommand((commandLine: string) => {
                // Log command with timestamp
                logCommand(commandLine);
                
                // Update command count in status bar
                updateCommandCountDisplay(statusBarItem);
            })
        );
    }
    
    // Setup command logging through terminal send text events
    context.subscriptions.push(
        vscode.window.onDidCloseTerminal(terminal => {
            // Log that the terminal was closed (to help with debugging)
            console.log(`Terminal closed: ${terminal.name}`);
            logCommand(`[Terminal closed: ${terminal.name}]`);
            updateCommandCountDisplay(statusBarItem);
        })
    );
    
    // Add enhanced tracking with terminal session data events
    if ('onDidChangeTerminalState' in vscode.window) {
        context.subscriptions.push(
            (vscode.window as any).onDidChangeTerminalState((terminal: vscode.Terminal) => {
                console.log(`Terminal state changed: ${terminal.name}`);
                // This can help identify when commands might be running
                logCommand(`[Terminal state changed: ${terminal.name}]`);
                updateCommandCountDisplay(statusBarItem);
            })
        );
    }
    
    // Track terminal text selection (can indicate command copying)
    if ('onDidChangeTerminalSelection' in vscode.window) {
        context.subscriptions.push(
            (vscode.window as any).onDidChangeTerminalSelection(
                (event: { terminal: vscode.Terminal, selection: string }) => {
                    if (event.selection && event.selection.trim().length > 0) {
                        console.log(`Terminal selection in ${event.terminal.name}: ${event.selection}`);
                        // Possible command selection
                        logCommand(`[Command selection in ${event.terminal.name}]`);
                        updateCommandCountDisplay(statusBarItem);
                    }
                }
            )
        );
    }
    
    // Setup a command to manually log commands (useful for testing)
    context.subscriptions.push(
        vscode.commands.registerCommand('terminal-tracker.logCommand', async () => {
            const command = await vscode.window.showInputBox({
                prompt: 'Enter command to log',
                placeHolder: 'e.g., git status'
            });
            
            if (command) {
                logCommand(command);
                updateCommandCountDisplay(statusBarItem);
                vscode.window.showInformationMessage(`Command logged: ${command}`);
            }
        })
    );
    
    // Initialize status bar
    updateCommandCountDisplay(statusBarItem);
}

// Track terminal for command execution
function trackTerminal(terminal: vscode.Terminal) {
    console.log(`Tracking terminal: ${terminal.name}`);
    
    // For bash/zsh terminals, we can inject a command to help track command history
    if (terminal.name.toLowerCase().includes('bash') || 
        terminal.name.toLowerCase().includes('zsh') ||
        terminal.name.toLowerCase().includes('sh')) {
        
        // Send a command to set up PROMPT_COMMAND for command tracking
        // This is invisible to the user and logs commands to our tracker
        terminal.sendText(`
if [[ -z \${TERMINAL_TRACKER_INIT+x} ]]; then
    export TERMINAL_TRACKER_INIT=1
    log_vscode_command() {
        local cmd=\$(history 1)
        cmd=\$(echo "\$cmd" | sed 's/^[ ]*[0-9]\\+[ ]*//')
        if [ ! -z "\$cmd" ]; then
            echo "\$(date -u +"%Y-%m-%dT%H:%M:%SZ")\\t${terminal.name}\\t\$cmd" >> "${LOG_FILE}"
        fi
    }
    export PROMPT_COMMAND="log_vscode_command;\${PROMPT_COMMAND}"
    echo "Terminal tracker activated for ${terminal.name}"
fi`, true);
    } else if (terminal.name.toLowerCase().includes('cmd') || 
               terminal.name.toLowerCase().includes('powershell') ||
               terminal.name.toLowerCase().includes('command')) {
        // Windows terminals require different tracking approach
        if (terminal.name.toLowerCase().includes('powershell')) {
            // PowerShell tracking
            terminal.sendText(`
                # VSCode Terminal Tracker
                $global:TERMINAL_TRACKER_PATH = "${LOG_FILE.replace(/\\/g, '\\\\')}"
                function global:Prompt {
                    $lastCommand = Get-History -Count 1
                    if ($lastCommand) {
                        $timestamp = [DateTime]::UtcNow.ToString("yyyy-MM-ddTHH:mm:ssZ")
                        $commandText = $lastCommand.CommandLine
                        $terminalName = "${terminal.name}"
                        # Using simple concatenation to avoid tab escaping issues
                        Add-Content -Path $global:TERMINAL_TRACKER_PATH -Value ($timestamp + "	" + $terminalName + "	" + $commandText)
                    }
                    return "PS $($executionContext.SessionState.Path.CurrentLocation)> "
                }
                Write-Host "Terminal tracker activated for ${terminal.name}"
                `, true);
        } else {
            // CMD tracking is more limited, but we can try
            terminal.sendText(`echo Terminal tracker activated for ${terminal.name}`, true);
        }
    }
}

// Log a command to the log file
function logCommand(command: string) {
    try {
        // Create a timestamp
        const timestamp = new Date().toISOString();
        
        // Log command with timestamp and active terminal info
        const activeTerm = vscode.window.activeTerminal ? vscode.window.activeTerminal.name : 'unknown';
        
        fs.appendFileSync(
            LOG_FILE,
            `${timestamp}\t${activeTerm}\t${command}\n`
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
        
    } catch (error) {
        vscode.window.showErrorMessage(`Error generating heatmap data: ${error}`);
    }
}

// Update command count display in status bar
function updateCommandCountDisplay(statusBarItem: vscode.StatusBarItem) {
    try {
        if (!fs.existsSync(LOG_FILE)) {
            statusBarItem.text = STATUS_BAR_TITLE + ' (0)';
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
        
        statusBarItem.text = `${STATUS_BAR_TITLE} (${todayCount} today)`;
        
    } catch (error) {
        console.error('Error updating command count:', error);
    }
}

// Generate HTML for error message
function getErrorHTML(errorMessage: string): string {
    return `
    <!DOCTYPE html>
    <html lang="en">
    <head>
        <meta charset="UTF-8">
        <meta name="viewport" content="width=device-width, initial-scale=1.0">
        <title>Error</title>
        <style>
            body {
                font-family: var(--vscode-font-family);
                background-color: var(--vscode-editor-background);
                color: var(--vscode-editor-foreground);
                padding: 20px;
                display: flex;
                flex-direction: column;
                align-items: center;
                justify-content: center;
                height: 100vh;
                margin: 0;
            }
            .error-container {
                border: 1px solid var(--vscode-inputValidation-errorBorder);
                background-color: var(--vscode-inputValidation-errorBackground);
                color: var(--vscode-inputValidation-errorForeground);
                padding: 20px;
                border-radius: 5px;
                text-align: center;
                max-width: 80%;
            }
            h1 {
                margin-top: 0;
            }
        </style>
    </head>
    <body>
        <div class="error-container">
            <h1>Error Loading Heatmap</h1>
            <p>${errorMessage}</p>
            <p>Please check your extension configuration.</p>
            <p>Resources directory path: resources/heatmap.html</p>
        </div>
    </body>
    </html>
    `;
}

export function deactivate() {
    console.log('Terminal Tracker extension deactivated');
}