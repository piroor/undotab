var UndoTabService = { 
	
	PREFROOT : 'extensions.undotab@piro.sakura.ne.jp', 

	KEY_ID_PREFIX : 'undotab-shortcut-',
 
	get SessionStore() { 
		if (!this._SessionStore) {
			this._SessionStore = Components.classes['@mozilla.org/browser/sessionstore;1'].getService(Components.interfaces.nsISessionStore);
		}
		return this._SessionStore;
	},
	_SessionStore : null,
 
	get bundle() { 
		if (!this._bundle) {
			this._bundle = document.getElementById('undotab-bundle');
		}
		return this._bundle;
	},
	_bundle : null,
 
/* Utilities */ 
	
	evalInSandbox : function UT_evalInSandbox(aCode, aOwner) 
	{
		try {
			var sandbox = new Components.utils.Sandbox(aOwner || 'about:blank');
			return Components.utils.evalInSandbox(aCode, sandbox);
		}
		catch(e) {
		}
		return void(0);
	},
 
	evaluateXPath : function UT_evaluateXPath(aExpression, aContext, aType) 
	{
		if (!aType) aType = XPathResult.ORDERED_NODE_SNAPSHOT_TYPE;
		try {
			var doc = aContext.ownerDocument || aContext || document;
			var xpathResult = doc.evaluate(
					aExpression,
					aContext || document,
					this.NSResolver,
					aType,
					null
				);
		}
		catch(e) {
			return {
				singleNodeValue : null,
				snapshotLength  : 0,
				snapshotItem    : function UT_snapshotItem() {
					return null
				}
			};
		}
		return xpathResult;
	},
	
	NSResolver : { 
		lookupNamespaceURI : function UT_lookupNamespaceURI(aPrefix)
		{
			switch (aPrefix)
			{
				case 'xul':
					return 'http://www.mozilla.org/keymaster/gatekeeper/there.is.only.xul';
				case 'html':
				case 'xhtml':
					return 'http://www.w3.org/1999/xhtml';
				case 'xlink':
					return 'http://www.w3.org/1999/xlink';
				default:
					return '';
			}
		}
	},
  
	getArrayFromXPathResult : function UT_getArrayFromXPathResult(aXPathResult) 
	{
		if (!(aXPathResult instanceof Components.interfaces.nsIDOMXPathResult)) {
			aXPathResult = this.evaluateXPath.apply(this, arguments);
		}
		var max = aXPathResult.snapshotLength;
		var array = new Array(max);
		if (!max) return array;

		for (var i = 0; i < max; i++)
		{
			array[i] = aXPathResult.snapshotItem(i);
		}

		return array;
	},
 
	getTabBrowserFromChild : function UT_getTabBrowserFromChild(aTab) 
	{
		return this.evaluateXPath(
				'ancestor-or-self::xul:tabbrowser',
				aTab,
				XPathResult.FIRST_ORDERED_NODE_TYPE
			).singleNodeValue;
	},
 
	getTabs : function UT_getTabs(aTabBrowser) 
	{
		return this.evaluateXPath(
				'descendant::xul:tab',
				aTabBrowser.mTabContainer
			);
	},
 
	getTabsArray : function UT_getTabsArray(aTabBrowser) 
	{
		return this.getArrayFromXPathResult(this.getTabs(aTabBrowser));
	},
 
	getTabAt : function UT_getTabAt(aIndex, aTabBrowser) 
	{
		if (aIndex < 0) return null;
		return this.evaluateXPath(
				'descendant::xul:tab['+(aIndex+1)+']',
				aTabBrowser.mTabContainer,
				XPathResult.FIRST_ORDERED_NODE_TYPE
			).singleNodeValue;
	},
 
	importTab : function UT_importTab(aTab, aTabBrowser) 
	{
		var newTab = aTabBrowser.addTab('about:blank');
		var browser = newTab.linkedBrowser;
		browser.stop();
		browser.docShell;
		aTabBrowser.swapBrowsersAndCloseOther(newTab, aTab);
		aTabBrowser.setTabTitle(newTab);
		return newTab;
	},
 
	makeTabUnrecoverable : function UT_makeTabUnrecoverable(aTab) 
	{
		// nsSessionStore.js doesn't save the tab to the undo cache
		// if the tab is completely blank.
		var b = aTab.linkedBrowser;
		try {
			b.stop();
			if (b.sessionHistory)
				b.sessionHistory.PurgeHistory(b.sessionHistory.count);
		}
		catch(e) {
			dump(e+'\n');
		}
		if (b.contentWindow && b.contentWindow.location)
			b.contentWindow.location.replace('about:blank');
	},
 
	parseShortcut : function UT_parseShortcut(aShortcut) 
	{
		var accelKey = navigator.platform.toLowerCase().indexOf('mac') == 0 ? 'meta' : 'ctrl' ;
		aShortcut = aShortcut.replace(/accel/gi, accelKey);

		var keys = (aShortcut || '').split('+');

		var keyCode = keys[keys.length-1].replace(/ /g, '_').toUpperCase();
		var key     = keyCode;

		var keyCodeName = (keyCode.length == 1 || keyCode == 'SPACE' || !keyCode) ? '' : 'VK_'+keyCode ;
		key = keyCodeName ? '' : keyCode ;

		return {
			key      : key,
			charCode : (key ? key.charCodeAt(0) : 0 ),
			keyCode  : keyCodeName,
			altKey   : /alt/i.test(aShortcut),
			ctrlKey  : /ctrl|control/i.test(aShortcut),
			metaKey  : /meta/i.test(aShortcut),
			shiftKey : /shift/i.test(aShortcut),
			string   : (aShortcut || ''),
			modified : false
		};
	},
  
/* Commands */ 
	
	undo : function UT_undo() 
	{
		return window['piro.sakura.ne.jp'].operationHistory.undo('TabbarOperations', window);
	},
 
	redo : function UT_redo() 
	{
		return window['piro.sakura.ne.jp'].operationHistory.redo('TabbarOperations', window);
	},
 
	getHistory : function UT_getHistory()
	{
		return window['piro.sakura.ne.jp'].operationHistory.getHistory('TabbarOperations', window);
	},
 
	updateKey : function UT_updateKey(aId, aCommand, aShortcut) 
	{
		var id = this.KEY_ID_PREFIX+aId;
		var key = document.getElementById(id);
		if (key)
			key.parentNode.removeChild(key);

		if (!aShortcut.key && !aShortcut.keyCode) return;

		key = document.createElement('key');
		key.setAttribute('id', id);
		key.setAttribute('oncommand', aCommand);

		var modifiers = [];
		if (aShortcut.altKey) modifiers.push('alt');
		if (aShortcut.ctrlKey) modifiers.push('control');
		if (aShortcut.metaKey) modifiers.push('meta');
		if (aShortcut.shiftKey) modifiers.push('shift');
		modifiers = modifiers.join(',');
		if (modifiers)
			key.setAttribute('modifiers', modifiers);

		if (aShortcut.key)
			key.setAttribute('key', aShortcut.key);

		if (aShortcut.keyCode)
			key.setAttribute('keycode', aShortcut.keyCode);

		var keyset = document.getElementById('mainKeyset');
		keyset.appendChild(key);
	},
  
/* Initializing */ 
	
	init : function UT_init() 
	{
		if (!('gBrowser' in window)) return;

		window.removeEventListener('DOMContentLoaded', this, false);
		window.addEventListener('unload', this, false);

		this.addPrefListener(this);
		window.setTimeout(function(aSelf) {
			aSelf.observe(null, 'nsPref:changed', aSelf.PREFROOT+'.undo.shortcut');
			aSelf.observe(null, 'nsPref:changed', aSelf.PREFROOT+'.redo.shortcut');
		}, 0, this);

		this.overrideGlobalFunctions();
		this.initTabBrowser(document.getElementById('content'));
	},
	
	overrideGlobalFunctions : function UT_overrideGlobalFunctions() 
	{
		eval('window.undoCloseTab = '+window.undoCloseTab.toSource().replace(
			/(\(([^\)]*)\)\s*\{)/,
			<![CDATA[$1
				return UndoTabService.onUndoCloseTab(
					function($2) {
			]]>
		).replace(
			/(\}\)?)$/,
			<![CDATA[
					},
					this,
					arguments
				);
			$1]]>
		));
	},
 
	initTabBrowser : function UT_initTabBrowser(aTabBrowser) 
	{
		eval('aTabBrowser.addTab = '+aTabBrowser.addTab.toSource().replace(
			/(([a-zA-Z0-9_]+).dispatchEvent\([^\)]+\);)/,
			<![CDATA[
				UndoTabService.onTabOpen(
					function() {
						$1
					},
					this,
					$2,
					arguments
				);
			]]>
		));

		eval('aTabBrowser.loadOneTab = '+aTabBrowser.loadOneTab.toSource().replace(
			/(var tab = this.addTab\([^\;]+\);)/,
			<![CDATA[
				var tab = UndoTabService.onLoadOneTab(
					function() {
						$1
						return tab;
					},
					this,
					tab,
					arguments
				);
			]]>
		));

		if ('_beginRemoveTab' in aTabBrowser) {
			eval('aTabBrowser._beginRemoveTab = '+aTabBrowser._beginRemoveTab.toSource().replace(
				/(([a-zA-Z0-9_]+).dispatchEvent\([^\)]+\);)/,
				<![CDATA[
					UndoTabService.onTabClose(
						function() {
							$1
						},
						this,
						$2
					);
				]]>
			));
		}
		else {
			eval('aTabBrowser.removeTab = '+aTabBrowser.removeTab.toSource().replace(
				/(([^;\s\.]+).dispatchEvent\(([^\)]+)\);)/,
				<![CDATA[
					UndoTabService.onTabClose(
						function() {
							$1
						},
						this,
						$2
					);
				]]>
			));
		}

		eval('aTabBrowser.moveTabTo = '+aTabBrowser.moveTabTo.toSource().replace(
			/(([a-zA-Z0-9_]+).dispatchEvent\(([^\)]+)\);)/,
			<![CDATA[
				UndoTabService.onTabMove(
					function() {
						$1
					},
					this,
					$2,
					$3.detail
				);
			]]>
		));

		if ('swapBrowsersAndCloseOther' in aTabBrowser) {
			eval('aTabBrowser.swapBrowsersAndCloseOther = '+aTabBrowser.swapBrowsersAndCloseOther.toSource().replace(
				'{',
				<![CDATA[{
					UndoTabService.swapBrowsersAndCloseOther(
						function() {
				]]>
			).replace(
				/(\}\)?)$/,
				<![CDATA[
						},
						this,
						arguments
					);
				$1]]>
			));
		}

		if ('_onDrop' in aTabBrowser) {
			eval('aTabBrowser._onDrop = '+aTabBrowser._onDrop.toSource().replace(
				/(newTab = this.addTab\("about:blank"\);.*this.swapBrowsersAndCloseOther\(newTab, draggedTab\);)/,
				<![CDATA[
					UndoTabService.importTabOnDrop(
						function() {
							$1
							return newTab;
						},
						this,
						draggedTab
					);
				]]>
			).replace(
				/(newTab = this.loadOneTab\([^;]*\);.*this.moveTabTo\([^;]*\);)/,
				<![CDATA[
					UndoTabService.openNewTabOnDrop(
						function() {
							$1
							return newTab;
						},
						this
					);
				]]>
			));
		}

		if ('_onDragEnd' in aTabBrowser && 'swapBrowsersAndCloseOther' in aTabBrowser) {
			eval('aTabBrowser._onDragEnd = '+aTabBrowser._onDragEnd.toSource().replace(
				/(this.replaceTabWithWindow\(draggedTab\);)/,
				<![CDATA[
					UndoTabService.onNewWindowFromTab(
						function() {
							return $1
						},
						this,
						draggedTab
					);
				]]>
			));
		}

		this.getTabsArray(aTabBrowser).forEach(function(aTab) {
			this.initTab(aTab);
		}, this);
	},
 
	initTab : function UT_initTab(aTab) 
	{
	},
  
	destroy : function UT_destroy() 
	{
		this.destroyTabBrowser(gBrowser);
		window.addEventListener('mouseup', this, true);

		window.removeEventListener('unload', this, false);

		this.removePrefListener(this);

		this.getTabsArray(gBrowser).forEach(function(aTab) {
			this.destroyTab(aTab);
		}, this);
	},
	
	destroyTabBrowser : function UT_destroyTabBrowser(aTabBrowser) 
	{
	},
 
	destroyTab : function UT_destroyTab(aTab) 
	{
	},
   
/* Event Handling */ 
	
	handleEvent : function UT_handleEvent(aEvent) 
	{
		switch (aEvent.type)
		{
			case 'DOMContentLoaded':
				this.init();
				break;

			case 'unload':
				this.destroy();
				break;
		}
	},
 
	onTabOpen : function UT_onTabOpen(aTask, aTabBrowser, aTab, aArguments) 
	{
		var position = aTab._tPos;
		var selected = aTab.selected;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				label  : this.bundle.getString('undo_addTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var newTab = UndoTabService.getTabAt(position, aTabBrowser);
					if (!newTab) return false;
					selected = newTab.selected;
					UndoTabService.makeTabUnrecoverable(newTab);
					aTabBrowser.removeTab(newTab);
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;
					var tab = aTabBrowser.addTab.apply(aTabBrowser, aArguments);
					aTabBrowser.moveTabTo(tab, position);
					position = tab._tPos;
					if (selected)
						aTabBrowser.selectedTab = tab;
				}
			}
		);
	},
 
	onLoadOneTab : function UT_onLoadOneTab(aTask, aTabBrowser, aTab, aArguments) 
	{
		var newTab;
		var position;
		var selected;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				newTab = aTask.call(aTabBrowser);
				position = newTab._tPos;
			},

			'TabbarOperations',
			window,
			{
				label  : this.bundle.getString('undo_loadOneTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var newTab = UndoTabService.getTabAt(position, aTabBrowser);
					if (!newTab) return false;
					selected = newTab.selected;
					UndoTabService.makeTabUnrecoverable(newTab);
					aTabBrowser.removeTab(newTab);
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;
					var tab = aTabBrowser.loadOneTab.apply(aTabBrowser, aArguments);
					aTabBrowser.moveTabTo(tab, position);
					position = tab._tPos;
					if (selected)
						aTabBrowser.selectedTab = tab;
				}
			}
		);
		return newTab;
	},
 
	onTabClose : function UT_onTabClose(aTask, aTabBrowser, aTab) 
	{
		var position = aTab._tPos;
		var selected = aTab.selected;
		var state = this.SessionStore.getTabState(aTab);

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				label  : this.bundle.getString('undo_removeTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var newTab = aTabBrowser.addTab('about:blank');
					UndoTabService.SessionStore.setTabState(newTab, state, false);
					aTabBrowser.moveTabTo(newTab, position);
					position = newTab._tPos;
					if (selected)
						aTabBrowser.selectedTab = newTab;
				},
				onRedo : function(aInfo) {
					var tab = UndoTabService.getTabAt(position, aTabBrowser);
					if (!tab) return false;
					if (aInfo.level) return;
					selected = tab.selected;
					UndoTabService.makeTabUnrecoverable(tab);
					aTabBrowser.removeTab(tab);
				}
			}
		);
	},
 
	onTabMove : function UT_onTabMove(aTask, aTabBrowser, aTab, aOldPosition) 
	{
		var newPosition = aTab._tPos;
		var oldPosition = aOldPosition;

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				label  : this.bundle.getString('undo_moveTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var tab = UndoTabService.getTabAt(newPosition, aTabBrowser);
					if (!tab) return false;
					aTabBrowser.moveTabTo(tab, oldPosition);
					oldPosition = tab._tPos;
				},
				onRedo : function(aInfo) {
					var tab = UndoTabService.getTabAt(oldPosition, aTabBrowser);
					if (!tab) return false;
					if (aInfo.level) return;
					aTabBrowser.moveTabTo(tab, newPosition);
					newPosition = tab._tPos;
				}
			}
		);

		aTab = null;
	},
 
	swapBrowsersAndCloseOther : function UT_swapBrowsersAndCloseOther(aTask, aTabBrowser, aArgs) 
	{
		var targetTab = aArgs[0];
		var targetTabPosition = targetTab._tPos;
		var targetId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(targetTab.ownerDocument.defaultView);
		var targetLabel = this.bundle.getString('undo_importTab_target_label');

		var remoteTab = aArgs[1];
		var remoteTabPosition = remoteTab._tPos;
		var remoteId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(remoteTab.ownerDocument.defaultView);
		var remoteLabel = this.bundle.getString('undo_importTab_remote_label');

		var remoteIsSelected = remoteTab.selected;

		var sourceEntry;
		var targetEntry;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				aTask.call(aTabBrowser);
				var remoteWindow = aInfo.manager.getWindowById(remoteId);
				aInfo.manager.addEntry(
					'TabbarOperations',
					remoteWindow,
					{
						label  : remoteLabel,
						onUndo : function(aInfo) {
							if (aInfo.level) return;

							var remoteWindow = aInfo.manager.getWindowById(remoteId);
							var targetWindow = aInfo.manager.getWindowById(targetId);
							if (!remoteWindow || !targetWindow) return false;

							var history = aInfo.manager.getHistory('TabbarOperations', targetWindow);
							if (history.currentEntry == sourceEntry) {
								targetWindow.setTimeout(function() {
									aInfo.manager.undo('TabbarOperations', targetWindow);
								}, 0);
								return;
							}

							sourceEntry.onUndo();
						},
						onRedo : function(aInfo) {
							if (aInfo.level) return;

							var remoteWindow = aInfo.manager.getWindowById(remoteId);
							var targetWindow = aInfo.manager.getWindowById(targetId);
							if (!remoteWindow || !targetWindow) return false;

							var history = aInfo.manager.getHistory('TabbarOperations', targetWindow);
							if (history.currentEntry == sourceEntry) {
								targetWindow.setTimeout(function() {
									aInfo.manager.redo('TabbarOperations', targetWindow);
								}, 0);
								return;
							}

							sourceEntry.onRedo();
						}
					}
				);
			},

			'TabbarOperations',
			window,
			(sourceEntry = {
				label  : targetLabel,
				onUndo : function(aInfo) {
					if (aInfo.level) return;

					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					var targetWindow = aInfo.manager.getWindowById(targetId);
					if (!remoteWindow || !targetWindow) return false;

					var remoteService = remoteWindow.UndoTabService;

					var remoteBrowser = remoteWindow.gBrowser;
					var targetTab = targetWindow.UndoTabService.getTabAt(targetTabPosition, aTabBrowser);

					var isLast = targetWindow.UndoTabService.getTabs(aTabBrowser).snapshotLength == 1;
					if (isLast)
						aTabBrowser.addTab();

					var remoteTab = remoteWindow.UndoTabService.importTab(targetTab, remoteBrowser);
					remoteBrowser.moveTabTo(remoteTab, remoteTabPosition);
					if (remoteIsSelected)
						remoteBrowser.selectedTab = remoteTab;

					if (isLast)
						window.setTimeout(function() {
							window.close();
						}, 0);
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;

					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					var targetWindow = aInfo.manager.getWindowById(targetId);
					if (!remoteWindow || !targetWindow) return false;

					var remoteService = remoteWindow.UndoTabService;

					var remoteBrowser = remoteWindow.gBrowser;
					var remoteTab = remoteWindow.UndoTabService.getTabAt(remoteTabPosition, remoteBrowser);

					var targetTab = targetWindow.UndoTabService.importTab(remoteTab, aTabBrowser);
					aTabBrowser.moveTabTo(targetTab, targetTabPosition);
					if (remoteIsSelected)
						aTabBrowser.selectedTab = targetTab;
				}
			})
		);

		targetTab = null;
		remoteTab = null;
	},
 
	importTabOnDrop : function UT_openNewTabOnDrop(aTask, aTabBrowser, aDraggedTab) 
	{
		var targetId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(window);
		var targetTabPosition = -1;

		var remoteId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(aDraggedTab.ownerDocument.defaultView);
		var remoteTabPosition = aDraggedTab._tPos;
		var remoteTabSelected = aDraggedTab.selected;

		var entry;
		var remoteLabel = this.bundle.getString('undo_importTabOnDrop_remote_label');

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				targetTabPosition = aTask.call(aTabBrowser)._tPos;
				var remoteWindow = aInfo.manager.getWindowById(remoteId);
				aInfo.manager.addEntry(
					'TabbarOperations',
					remoteWindow,
					{ __proto__ : entry,
					  label     : remoteLabel }
				);
			},

			'TabbarOperations',
			window,
			(entry = {
				label  : this.bundle.getString('undo_importTabOnDrop_target_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;

					var targetWindow = aInfo.manager.getWindowById(targetId);
					if (!targetWindow) return false;

					var targetBrowser = aTabBrowser && aTabBrowser.parentNode ? aTabBrowser : targetWindow.gBrowser;
					var targetTab = targetWindow.UndoTabService.getTabAt(targetTabPosition, targetBrowser);

					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					if (!remoteWindow) {
						let continuation = aInfo.getContinuation();
						targetWindow.setTimeout(function() {
							var remoteWindow = targetBrowser.replaceTabWithWindow(targetTab);
							remoteWindow.addEventListener('load', function() {
								remoteWindow.removeEventListener('load', arguments.callee, false);
								remoteId = aInfo.manager.getWindowId(remoteWindow);
								remoteWindow.setTimeout(function() { // wait for tab swap
									aInfo.manager.addEntry(
										'TabbarOperations',
										remoteWindow,
										{ __proto__ : entry,
										  label     : remoteLabel }
									);
									continuation();
								}, 0);
							}, false);
						}, 0);
					}
					else {
						let history = aInfo.manager.getHistory('TabbarOperations', targetWindow);
						if (this != entry && history.currentEntry == entry) {
							targetWindow.setTimeout(function() {
								aInfo.manager.undo('TabbarOperations', targetWindow);
							}, 0);
							return;
						}
						let remoteBrowser = remoteWindow.gBrowser;
						let remoteTab = remoteWindow.UndoTabService.importTab(targetTab, remoteBrowser);
						remoteBrowser.moveTabTo(remoteTab, remoteTabPosition);
						if (remoteTabSelected)
							remoteBrowser.selectedTab = remoteTab;
					}
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;

					var targetWindow = aInfo.manager.getWindowById(targetId);
					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					if (!targetWindow || !remoteWindow) return false;

					var history = aInfo.manager.getHistory('TabbarOperations', targetWindow);
					if (this != entry && history.currentEntry == entry) {
						targetWindow.setTimeout(function() {
							aInfo.manager.redo('TabbarOperations', targetWindow);
						}, 0);
						return;
					}

					var targetBrowser = aTabBrowser && aTabBrowser.parentNode ? aTabBrowser : targetWindow.gBrowser;
					var remoteBrowser = remoteWindow.gBrowser;
					var remoteTab = remoteWindow.UndoTabService.getTabAt(remoteTabPosition, remoteBrowser);

					var isLast = remoteWindow.UndoTabService.getTabs(remoteBrowser).length == 1;
					if (isLast)
						remoteBrowser.addTab('about:blank');

					var targetTab = targetWindow.UndoTabService.importTab(remoteTab, targetBrowser);
					targetBrowser.moveTabTo(remoteTab, targetTabPosition);
					if (remoteTabSelected)
						targetBrowser.selectedTab = targetTab;

					var continuation = aInfo.getContinuation();
					remoteWindow.setTimeout(function() {
						remoteWindow.close();
						continuation();
					}, 0);
				}
			})
		);
		aDraggedTab = null;
	},
 
	openNewTabOnDrop : function UT_openNewTabOnDrop(aTask, aTabBrowser) 
	{
		var position = -1;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				if (aInfo.level) return;
				position = aTask.call(aTabBrowser)._tPos;
			},

			'TabbarOperations',
			window,
			{
				label  : this.bundle.getString('undo_addTabOnDrop_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var tab = UndoTabService.getTabAt(position, aTabBrowser);
					UndoTabService.makeTabUnrecoverable(tab);
					aTabBrowser.removeTab(tab);
				}
			}
		);
	},
 
	onNewWindowFromTab : function UT_openNewTabOnDrop(aTask, aTabBrowser, aTab) 
	{
		var sourceId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(window);
		var remoteId;
		var position = aTab._tPos;
		var selected = aTab.selected;
		var entry;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				var continuation = aInfo.getContinuation();
				var newWindow = aTask.call(aTabBrowser);
				newWindow.addEventListener('load', function() {
					newWindow.removeEventListener('load', arguments.callee, false);
					remoteId = aInfo.manager.getWindowId(newWindow);
					newWindow.setTimeout(function() { // wait for tab swap
						aInfo.manager.addEntry(
							'TabbarOperations',
							newWindow,
							{ __proto__ : entry }
						);
						continuation();
					}, 0);
				}, false);
			},

			'TabbarOperations',
			window,
			(entry = {
				label  : this.bundle.getString('undo_newWindowFromTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;

					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					var targetWindow = aInfo.manager.getWindowById(sourceId);
					if (!targetWindow || !remoteWindow) return false;

					var history = aInfo.manager.getHistory('TabbarOperations', targetWindow);
					if (this != entry && history.currentEntry == entry) {
						targetWindow.setTimeout(function() {
							aInfo.manager.undo('TabbarOperations', targetWindow);
						}, 0);
						return;
					}

					var targetBrowser = aTabBrowser && aTabBrowser.parentNode ? aTabBrowser : targetWindow.gBrowser;
					var remoteTab = remoteWindow.gBrowser.selectedTab;
					var targetTab = targetWindow.UndoTabService.importTab(remoteTab, targetBrowser);
					targetBrowser.moveTabTo(targetTab, position);
					position = targetTab._tPos;
					if (selected)
						targetBrowser.selectedTab = targetTab;
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;

					var sourceWindow = aInfo.manager.getWindowById(sourceId);
					if (!sourceWindow) return false;

					var sourceBrowser = aTabBrowser && aTabBrowser.parentNode ? aTabBrowser : sourceWindow.gBrowser;
					var tab = sourceWindow.UndoTabService.getTabAt(position, sourceBrowser);
					if (!tab) return false;

					var continuation = aInfo.getContinuation();
					sourceWindow.setTimeout(function() {
						var remoteWindow = sourceBrowser.replaceTabWithWindow(tab);
						remoteWindow.addEventListener('load', function() {
							remoteWindow.removeEventListener('load', arguments.callee, false);
							remoteId = aInfo.manager.getWindowId(remoteWindow);
							remoteWindow.setTimeout(function() { // wait for tab swap
								continuation();
								// While redoing, addEntry() is ignored. So, we have to call
								// continuation() before calling addEntry().
								aInfo.manager.addEntry(
									'TabbarOperations',
									remoteWindow,
									{ __proto__ : entry }
								);
							}, 0);
						}, false);
					}, 0);
				}
			})
		);
	},
 
	onUndoCloseTab : function UT_onUndoCloseTab(aTask, aThis, aArguments) 
	{
		var position = -1;
		var selected;
		var state;
		var tab;
		var tabbrowser;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				tab = aTask.apply(aThis, aArguments);
				if (tab) {
					position = tab._tPos;
					selected = tab.selected;
					tabbrowser = UndoTabService.getTabBrowserFromChild(tab);
				}
			},

			'TabbarOperations',
			window,
			{
				label  : this.bundle.getString('undo_undoCloseTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.level) return;

					if (!tabbrowser || !tabbrowser.parentNode) {
						tabbrowser = null;
						return false;
					}

					var tab = UndoTabService.getTabAt(position, tabbrowser);
					if (!tab) return false;

					state = UndoTabService.SessionStore.getTabState(tab);
					tabbrowser.removeTab(tab);
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;

					if (!tabbrowser || !tabbrowser.parentNode) {
						tabbrowser = null;
						return false;
					}

					var tab = tabbrowser.addTab();
					UndoTabService.SessionStore.setTabState(tab, state);
					tabbrowser.moveTabTo(tab, position);
					position = tab._tPos;
					if (selected)
						tabbrowser.selectedTab = tab;
				}
			}
		);
		return tab;
	},
  
/* Prefs */ 
	
	domain : 'extensions.undotab@piro.sakura.ne.jp', 
 
	getSelfPref : function UT_getSelfPref(aPrefName) 
	{
		return this.getPref(this.PREFROOT+'.'+aPrefName);
	},
 
	setSelfPref : function UT_setSelfPref(aPrefName, aValue) 
	{
		return this.setPref(this.PREFROOT+'.'+aPrefName, aValue);
	},
 
	clearSelfPref : function UT_clearSelfPref(aPrefName) 
	{
		return this.clearPref(this.PREFROOT+'.'+aPrefName);
	},
 
	observe : function UT_observe(aSubject, aTopic, aPrefName) 
	{
		if (aTopic != 'nsPref:changed') return;

		var value = this.getPref(aPrefName);
		switch (aPrefName.replace(this.PREFROOT+'.', ''))
		{
			case 'undo.shortcut':
				this.updateKey('undo', 'UndoTabService.undo();', this.parseShortcut(value));
				break;

			case 'redo.shortcut':
				this.updateKey('redo', 'UndoTabService.redo();', this.parseShortcut(value));
				break;

			default:
				break;
		}
	}
  
}; 
UndoTabService.__proto__ = window['piro.sakura.ne.jp'].prefs;

window.addEventListener('DOMContentLoaded', UndoTabService, false);
  
