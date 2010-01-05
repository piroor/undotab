var UndoTabOpsService = { 
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

		window.removeEventListener('load', this, false);
		window.addEventListener('unload', this, false);

		this.addPrefListener(this);

		this.initTabBrowser(gBrowser);
	},
	
	initTabBrowser : function UT_initTabBrowser(aTabBrowser) 
	{
		eval('aTabBrowser.addTab = '+aTabBrowser.addTab.toSource().replace(
			/(([^;\s\.]+).dispatchEvent\(([^\)]+)\);)/,
			<![CDATA[
				UndoTabOpsService.onTabOpen(
					function() {
						$1
					},
					this,
					$2,
					arguments
				);
			]]>
		));

		if ('_beginRemoveTab' in aTabBrowser) {
			eval('aTabBrowser._beginRemoveTab = '+aTabBrowser._beginRemoveTab.toSource().replace(
				/(([^;\s\.]+).dispatchEvent\(([^\)]+)\);)/,
				<![CDATA[
					UndoTabOpsService.onTabClose(
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
					UndoTabOpsService.onTabClose(
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
			/(([^;\s\.]+).dispatchEvent\(([^\)]+)\);)/,
			<![CDATA[
				UndoTabOpsService.onTabMove(
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
				/(this\.replaceTabWithWindow\(([^;]*)\);)/,
				<![CDATA[
					UndoTabOpsService.replaceTabWithWindow(
						function(aDraggedTab) {
							draggedTab = aDraggedTab;
							return $1
						},
						this,
						[$2]
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
			case 'load':
				this.init();
				break;

			case 'unload':
				this.destroy();
				break;
		}
	},
 
	onTabOpen : function(aTask, aTabBrowser, aTab, aArguments) 
	{
Application.console.log('onTabOpen');
		var newTab = aTab;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			(targetEntry = {
				label  : 'open new tab',
				onUndo : function(aInfo) {
Application.console.log('onTabOpen undo '+aInfo.level);
					if (!newTab || !newTab.parentNode) {
						newTab = null;
						return false;
					}
					if (aInfo.level)
						return false;
					aTabBrowser.removeTab(newTab);
				},
				onRedo : function(aInfo) {
Application.console.log('onTabOpen redo '+aInfo.level);
					if (aInfo.level)
						return false;
					newTab = aTabBrowser.addTab.apply(aTabBrowser, aArguments);
				}
			})
		);
	},
 
	onTabClose : function(aTask, aTabBrowser, aTab) 
	{
Application.console.log('onTabClose');
		var position = aTab._tPos;
		var state = this.SessionStore.getTabState(aTab);
		var newTab;

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			(targetEntry = {
				label  : 'open new tab',
				onUndo : function(aInfo) {
Application.console.log('onTabClose undo '+aInfo.level);
					if (aInfo.level)
						return false;
					newTab = aTabBrowser.addTab('about:blank');
					UndoTabOpsService.SessionStore.setTabState(newTab, state, false);
					aTabBrowser.moveTabTo(newTab, position);
				},
				onRedo : function(aInfo) {
Application.console.log('onTabClose redo '+aInfo.level);
					if (aInfo.level || !newTab)
						return false;
					UndoTabOpsService.makeTabUnrecoverable(newTab);
					aTabBrowser.removeTab(newTab);
					newTab = null;
				}
			})
		);
	},
 
	onTabMove : function(aTask, aTabBrowser, aTab, aOldPosition) 
	{
Application.console.log('onTabMove');
		var newIndex = aTab._tPos;
		var oldIndex = aOldPosition;

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			(targetEntry = {
				label  : 'rearrange tab',
				onUndo : function(aInfo) {
Application.console.log('onTabMove undo '+aInfo.level);
					if (!aTab || !aTab.parentNode) {
						aTab = null;
						return false;
					}
					if (aInfo.level)
						return false;
					aTabBrowser.moveTabTo(aTab, oldIndex);
				},
				onRedo : function(aInfo) {
Application.console.log('onTabMove redo '+aInfo.level);
					if (!aTab || !aTab.parentNode) {
						aTab = null;
						return false;
					}
					if (aInfo.level)
						return false;
					aTabBrowser.moveTabTo(aTab, newIndex);
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

		var isLastTab = this.getTabs(sourceBrowser).snapshotLength == 1;
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
					if (isLastTab) {
						let sourceWindow = window.openDialog(location.href, '_blank', 'chrome,all,dialog=no', 'about:blank');
						sourceWindow.addEventListener('load', function() {
							sourceWindow.removeEventListener('load', arguments.callee, false);
							sourceWindow.setTimeout(function() {
								var targetBrowser = sourceWindow.gBrowser;
								newTabs = newTabs.map(function(aTab) {
									var newTab = window.UndoTabOpsService.importTab(aTab, targetBrowser);
									targetBrowser.moveTabTo(newTab, sourceIndex);
									if (sourceIsSelected)
										targetBrowser.selectedTab = newTab;
									return newTab;
								});
								window.UndoTabOpsService.getTabsArray(targetBrowser)
									.forEach(function(aTab) {
										if (newTabs.indexOf(aTab) < 0) {
											window.UndoTabOpsService.makeTabUnrecoverable(aTab);
											targetBrowser.removeTab(aTab);
										}
									});
								sourceId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(sourceWindow, sourceId);
								sourceWindow['piro.sakura.ne.jp'].operationHistory.addEntry(
									'TabbarOperations',
									sourceWindow,
									sourceEntry
								);
							}, 0);
						}, false);
					}
					else {
						let sourceWindow = this.getSourceWindow();
						if (!sourceWindow) return false;

						let targetBrowser = sourceBrowser;

						newTabs = newTabs.map(function(aTab) {
							var newTab = window.UndoTabOpsService.importTab(aTab, targetBrowser);
							targetBrowser.moveTabTo(newTab, sourceIndex);
							if (sourceIsSelected)
								targetBrowser.selectedTab = newTab;
							return newTab;
						});
					}
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
 
	replaceTabWithWindow : function(aTask, aTabBrowser, aArgs) 
	{
		var targetId;
		var draggedTab = aArgs[0];

		var sourceId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(window);
		var sourceIndex = draggedTab._tPos;
		var sourceIsSelected = draggedTab.selected;

		var sourceEntry;
		var targetEntry;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function() {
				var targetWindow = aTask.call(aTabBrowser, draggedTab);
				targetWindow.addEventListener('load', function() {
					targetWindow.removeEventListener('load', arguments.callee, false);
					targetId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(targetWindow);
					targetWindow['piro.sakura.ne.jp'].operationHistory.addEntry(
						'TabbarOperations',
						targetWindow,
						{
							label  : 'split tab to a new window',
							onUndo : function() {
								var sourceWindow = targetWindow['piro.sakura.ne.jp'].operationHistory.getWindowById(sourceId);
								if (!sourceWindow ||
									!aTabBrowser ||
									!aTabBrowser.parentNode ||
									!targetEntry)
									return false;

								var history = targetWindow['piro.sakura.ne.jp'].operationHistory.getHistory('TabbarOperations', targetWindow);
								if (history.entries[history.index] == sourceEntry) {
									targetWindow.setTimeout(function() {
										targetWindow['piro.sakura.ne.jp'].operationHistory.undo('TabbarOperations', targetWindow);
									}, 0);
									return;
								}

								sourceEntry.onUndo();
							}
						}
					);
				}, false);
			},

			'TabbarOperations',
			window,
			(sourceEntry = {
				label  : 'split tab to a new window',
				onUndo : function() {
					var targetWindow = window['piro.sakura.ne.jp'].operationHistory.getWindowById(targetId);
					if (!targetWindow) return false;

					var browser = targetWindow.gBrowser;
					var blank = browser.addTab();

					draggedTab = window.UndoTabOpsService.importTab(browser.selectedTab, aTabBrowser);
					aTabBrowser.moveTabTo(draggedTab, sourceIndex);
					if (sourceIsSelected)
						aTabBrowser.selectedTab = draggedTab;

					targetWindow.setTimeout(function() {
						targetWindow.close();
					}, 0);
				}
			})
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
  
