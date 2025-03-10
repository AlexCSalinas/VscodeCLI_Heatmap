import * as assert from 'assert';
import * as vscode from 'vscode';

// Using global mocha functions which are available in the test environment
// without needing to import mocha directly
suite('Extension Test Suite', () => {
	vscode.window.showInformationMessage('Starting test suite');

	test('Sample test', () => {
		assert.strictEqual(1 + 1, 2);
	});
});

// Declare the mocha globals to satisfy the TypeScript compiler
declare function suite(name: string, fn: () => void): void;
declare function test(name: string, fn: () => void): void;