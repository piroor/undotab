var UndoTabOpsService = { 
	PREFROOT : 'extensions.undotab@piro.sakura.ne.jp',
	
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
 
/* Initializing */ 
	
	init : function UT_init() 
	{
		if (!('gBrowser' in window)) return;

		window.removeEventListener('load', this, false);
		window.addEventListener('unload', this, false);

		this.addPrefListener(this);

		this.initTabBrowser(gBrowser);
	},
	
	initTabBrowser : function UT_initTabBrowser(aTabBrowser) 
	{
		if ('_onDrop' in aTabBrowser && 'swapBrowsersAndCloseOther' in aTabBrowser) {
			eval('aTabBrowser._onDrop = '+aTabBrowser._onDrop.toSource().replace(
				/(if \(newIndex != draggedTab._tPos\)\s*\{)(this.moveTabTo\(([^;]*)\);)(\})/,
				<![CDATA[
					$1
					UndoTabOpsService.moveTabOnDrop(
						function() {
							$2
						},
						this,
						[$3]
					);
					$4
				]]>
			).replace(
				/(newTab = this.addTab\("about:blank"\);.*this.selectedTab = newTab;)/,
				<![CDATA[
					UndoTabOpsService.importTabOnDrop(
						function() {
							$1
						},
						this,
						draggedTab
					);
				]]>
			).replace(
				/(newTab = this.loadOneTab\([^;]*\);.*this.moveTabTo\([^;]*\);)/,
				<![CDATA[
					UndoTabOpsService.openNewTabOnDrop(
						function() {
							$1
						},
						this
					);
				]]>
			));
		}

		if ('_onDragEnd' in aTabBrowser) {
			eval('aTabBrowser._onDragEnd = '+aTabBrowser._onDragEnd.toSource().replace(
				/(this\._?replaceTabWithWindow\()/,
				'if (UndoTabOpsService.isDraggingAllTabs(draggedTab)) return; $1'
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
			case 'load':
				this.init();
				break;

			case 'unload':
				this.destroy();
				break;
		}
	},
 
	moveTabOnDrop : function(aTask, aTabBrowser, aTabMoveArgs) 
	{
		var tab      = aTabMoveArgs[0];
		var newIndex = aTabMoveArgs[1];
		var oldIndex = tab._tPos;

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			(targetEntry = {
				label  : 'rearrange tab on drop',
				onUndo : function() {
					if (!tab || !tab.parentNode) {
						tab = null;
						return false;
					}
					aTabBrowser.moveTabTo(tab, oldIndex);
				},
				onRedo : function() {
					if (!tab || !tab.parentNode) {
						tab = null;
						return false;
					}
					aTabBrowser.moveTabTo(tab, newIndex);
				}
			})
		);
	},
 
	importTabOnDrop : function(aTask, aTabBrowser, aDraggedTab) 
	{
		var sourceWindow = aDraggedTab.ownerDocument.defaultView;
		var sourceBrowser = this.getTabBrowserFromChild(aDraggedTab);
		var sourceId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(sourceWindow);
		var sourceIndex = aDraggedTab._tPos;
		var sourceIsSelected = aDraggedTab.selected;

		var targetId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(window);

		var newTabs;
		var targetEntry;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				var beforeTabs = Array.slice(aTabBrowser.mTabContainer.childNodes);
				aTask.call(aTabBrowser);
				var tabs = Array.slice(aTabBrowser.mTabContainer.childNodes);
				newTabs = tabs.filter(function(aTab) {
								return beforeTabs.indexOf(aTab) < 0;
							});
			},

			'TabbarOperations',
			window,
			(targetEntry = {
				label  : 'move tab on drop',
				getSourceWindow : function() {
					var sourceWindow = window['piro.sakura.ne.jp'].operationHistory.getWindowById(sourceId);
					if (!sourceWindow || sourceWindow.closed || !sourceBrowser) {
						sourceBrowser = null;
					}
					return sourceWindow;
				},
				onUndo : function() {
					var sourceWindow = this.getSourceWindow();
					if (!sourceWindow) return false;

					var targetBrowser = sourceBrowser;

					newTabs = newTabs.map(function(aTab) {
						var newTab = window.UndoTabOpsService.importTab(aTab, targetBrowser);
						targetBrowser.moveTabTo(newTab, sourceIndex);
						if (sourceIsSelected)
							targetBrowser.selectedTab = newTab;
						return newTab;
					});
				},
				onRedo : function() {
					var sourceWindow = this.getSourceWindow();
					if (!sourceWindow) return false;

					var targetBrowser = aTabBrowser;

					newTabs = newTabs.map(function(aTab) {
						var newTab = window.UndoTabOpsService.importTab(aTab, targetBrowser);
						targetBrowser.moveTabTo(newTab, sourceIndex);
						if (sourceIsSelected)
							targetBrowser.selectedTab = newTab;
						return newTab;
					});
				}
			})
		);

		var sourceEntry;
		sourceWindow['piro.sakura.ne.jp'].operationHistory.addEntry(
			'TabbarOperations',
			sourceWindow,
			(sourceEntry = {
				label  : 'move tab on drop',
				getSourceWindow : function() {
					var sourceWindow = window['piro.sakura.ne.jp'].operationHistory.getWindowById(sourceId);
					if (!sourceWindow || sourceWindow.closed || !sourceBrowser) {
						sourceBrowser = null;
					}
					return sourceWindow;
				},
				getTargetWindow : function() {
					var targetWindow = window['piro.sakura.ne.jp'].operationHistory.getWindowById(targetId);
					if (!targetWindow || targetWindow.closed || !aTabBrowser) {
						aTabBrowser = null;
					}
					return targetWindow;
				},
				onUndo : function() {
					var sourceWindow = this.getSourceWindow();
					var targetWindow = this.getTargetWindow();
					if (!sourceWindow || !targetWindow) return false;

					var history = targetWindow['piro.sakura.ne.jp'].operationHistory.getHistory('TabbarOperations', targetWindow);
					if (history.entries[history.index] == targetEntry) {
						targetWindow.setTimeout(function() {
							targetWindow['piro.sakura.ne.jp'].operationHistory.undo('TabbarOperations', targetWindow);
						}, 0);
						return;
					}

					return false;
				},
				onRedo : function() {
					var sourceWindow = this.getSourceWindow();
					var targetWindow = this.getTargetWindow();
					if (!sourceWindow || !targetWindow) return false;

					var history = targetWindow['piro.sakura.ne.jp'].operationHistory.getHistory('TabbarOperations', targetWindow);
					if (history.entries[history.index] == targetEntry) {
						targetWindow.setTimeout(function() {
							targetWindow['piro.sakura.ne.jp'].operationHistory.redo('TabbarOperations', targetWindow);
						}, 0);
						return;
					}

					return false;
				}
			})
		);

		sourceWindow = null;
	},
 
	openNewTabOnDrop : function(aTask, aTabBrowser) 
	{
		var newTabs;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				var beforeTabs = Array.slice(aTabBrowser.mTabContainer.childNodes);
				aTask.call(aTabBrowser);
				var tabs = Array.slice(aTabBrowser.mTabContainer.childNodes);
				newTabs = tabs.filter(function(aTab) {
								return beforeTabs.indexOf(aTab) < 0;
							});
			},

			'TabbarOperations',
			window,
			{
				label  : 'new tab on drop',
				onUndo : function() {
					newTabs.forEach(function(aTab) {
						UndoTabOpsService.makeTabUnrecoverable(aTab);
						aTabBrowser.removeTab(aTab);
					});
					newTabs = [];
				}
			}
		);
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
UndoTabOpsService.__proto__ = window['piro.sakura.ne.jp'].prefs;

window.addEventListener('load', UndoTabOpsService, false);
  
