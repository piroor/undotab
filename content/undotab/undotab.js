var UndoTabService = { 
	PREFROOT : 'extensions.undotab@piro.sakura.ne.jp',
	
	get SessionStore() { 
		if (!this._SessionStore) {
			this._SessionStore = Components.classes['@mozilla.org/browser/sessionstore;1'].getService(Components.interfaces.nsISessionStore);
		}
		return this._SessionStore;
	},
	_SessionStore : null,
 
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
 
	undo : function()
	{
		return window['piro.sakura.ne.jp'].operationHistory.undo('TabbarOperations', window);
	},
 
	redo : function()
	{
		return window['piro.sakura.ne.jp'].operationHistory.redo('TabbarOperations', window);
	},
 
/* Initializing */ 
	
	init : function UT_init() 
	{
		if (!('gBrowser' in window)) return;

		window.removeEventListener('DOMContentLoaded', this, false);
		window.addEventListener('unload', this, false);

		this.addPrefListener(this);

		this.initTabBrowser(document.getElementById('content'));
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

		if ('_onDrop' in aTabBrowser && 'swapBrowsersAndCloseOther' in aTabBrowser) {
			eval('aTabBrowser._onDrop = '+aTabBrowser._onDrop.toSource().replace(
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
 
	onTabOpen : function(aTask, aTabBrowser, aTab, aArguments) 
	{
		var newTabIndex = aTab._tPos;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				label  : 'open new tab',
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var newTab = UndoTabService.getTabAt(newTabIndex, aTabBrowser);
					if (!newTab) return false;
					UndoTabService.makeTabUnrecoverable(newTab);
					aTabBrowser.removeTab(newTab);
					newTabIndex = -1;
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;
					var tab = aTabBrowser.addTab.apply(aTabBrowser, aArguments);
					aTabBrowser.moveTabTo(tab, newTabIndex);
					newTabIndex = tab._tPos;
				}
			}
		);
	},
 
	onLoadOneTab : function(aTask, aTabBrowser, aTab, aArguments) 
	{
		var newTabIndex;
		var newTab;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				newTab = aTask.call(aTabBrowser);
				newTabIndex = newTab._tPos;
			},

			'TabbarOperations',
			window,
			{
				label  : 'open new tab',
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var newTab = UndoTabService.getTabAt(newTabIndex, aTabBrowser);
					if (!newTab) return false;
					aTabBrowser.removeTab(newTab);
					newTabIndex = -1;
				},
				onRedo : function(aInfo) {
					if (aInfo.level) return;
					var tab = aTabBrowser.loadOneTab.apply(aTabBrowser, aArguments);
					aTabBrowser.moveTabTo(tab, newTabIndex);
					newTabIndex = tab._tPos;
				}
			}
		);
		return newTab;
	},
 
	onTabClose : function(aTask, aTabBrowser, aTab) 
	{
		var position = aTab._tPos;
		var state = this.SessionStore.getTabState(aTab);

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				label  : 'close tab',
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var newTab = aTabBrowser.addTab('about:blank');
					UndoTabService.SessionStore.setTabState(newTab, state, false);
					aTabBrowser.moveTabTo(newTab, position);
				},
				onRedo : function(aInfo) {
					var tab = UndoTabService.getTabAt(position, aTabBrowser);
					if (!tab) return false;
					if (aInfo.level) return;
					UndoTabService.makeTabUnrecoverable(tab);
					aTabBrowser.removeTab(tab);
				}
			}
		);
	},
 
	onTabMove : function(aTask, aTabBrowser, aTab, aOldPosition) 
	{
		var newIndex = aTab._tPos;
		var oldIndex = aOldPosition;

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				label  : 'move tab',
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var tab = UndoTabService.getTabAt(newIndex, aTabBrowser);
					if (!tab) return false;
					aTabBrowser.moveTabTo(tab, oldIndex);
				},
				onRedo : function(aInfo) {
					var tab = UndoTabService.getTabAt(oldIndex, aTabBrowser);
					if (!tab) return false;
					if (aInfo.level) return;
					aTabBrowser.moveTabTo(tab, newIndex);
				}
			}
		);

		aTab = null;
	},
 
	openNewTabOnDrop : function(aTask, aTabBrowser) 
	{
		var newTabIndex = -1;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				if (aInfo && aInfo.level) return;
				newTabIndex = aTask.call(aTabBrowser)._tPos;
			},

			'TabbarOperations',
			window,
			{
				label  : 'new tab on drop',
				onUndo : function(aInfo) {
					if (aInfo.level) return;
					var tab = UndoTabService.getTabAt(newTabIndex, aTabBrowser);
					UndoTabService.makeTabUnrecoverable(tab);
					aTabBrowser.removeTab(tab);
				}
			}
		);
	},
 
	swapBrowsersAndCloseOther : function(aTask, aTabBrowser, aArgs) 
	{
		var targetTab = aArgs[0];
		var targetTabIndex = targetTab._tPos;
		var targetId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(targetTab.ownerDocument.defaultView);

		var remoteTab = aArgs[1];
		var remoteTabIndex = remoteTab._tPos;
		var remoteId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(remoteTab.ownerDocument.defaultView);

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
						label  : 'export tab to foreign window',
						onUndo : function(aInfo) {
							if (aInfo.level) return;

							var remoteWindow = aInfo.manager.getWindowById(remoteId);
							var targetWindow = aInfo.manager.getWindowById(targetId);
							if (!remoteWindow || !targetWindow) return false;

							var history = aInfo.manager.getHistory('TabbarOperations', targetWindow);
							if (history.entries[history.index] == sourceEntry) {
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
							if (history.entries[history.index] == sourceEntry) {
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
				label  : 'import tab from foreign window',
				onUndo : function(aInfo) {
					if (aInfo.level) return;

					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					var targetWindow = aInfo.manager.getWindowById(targetId);
					if (!remoteWindow || !targetWindow) return false;

					var remoteService = remoteWindow.UndoTabService;

					var remoteBrowser = remoteWindow.gBrowser;
					var targetTab = UndoTabService.getTabAt(targetTabIndex, aTabBrowser);

					var isLast = UndoTabService.getTabs(aTabBrowser).snapshotLength == 1;
					if (isLast)
						aTabBrowser.addTab();

					var remoteTab = remoteWindow.UndoTabService.importTab(targetTab, remoteBrowser);
					remoteBrowser.moveTabTo(remoteTab, remoteTabIndex);
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
					var remoteTab = UndoTabService.getTabAt(remoteTabIndex, remoteBrowser);

					var targetTab = remoteWindow.UndoTabService.importTab(remoteTab, aTabBrowser);
					aTabBrowser.moveTabTo(targetTab, targetTabIndex);
					if (remoteIsSelected)
						aTabBrowser.selectedTab = targetTab;
				}
			})
		);

		targetTab = null;
		remoteTab = null;
	},
  
/* Pref Listener */ 
	
	domain : 'extensions.undotab', 
 
	observe : function UT_observe(aSubject, aTopic, aPrefName) 
	{
		if (aTopic != 'nsPref:changed') return;

		var value = this.getPref(aPrefName);
		switch (aPrefName)
		{
			case 'extensions.undotab.':
				break;

			default:
				break;
		}
	}
  
}; 
UndoTabService.__proto__ = window['piro.sakura.ne.jp'].prefs;

window.addEventListener('DOMContentLoaded', UndoTabService, false);
  
