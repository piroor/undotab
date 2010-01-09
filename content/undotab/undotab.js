var UndoTabService = { 
	
	PREFROOT : 'extensions.undotab@piro.sakura.ne.jp', 

	KEY_ID_PREFIX : 'undotab-shortcut-',
 
	get manager() {
		return window['piro.sakura.ne.jp'].operationHistory;
	},
 
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
 
	importTabTo : function UT_importTabTo(aTab, aTabBrowser) 
	{
		var newTab = aTabBrowser.addTab('about:blank');
		var browser = newTab.linkedBrowser;
		browser.stop();
		browser.docShell;
		aTabBrowser.swapBrowsersAndCloseOther(newTab, aTab);
		aTabBrowser.setTabTitle(newTab);
		return newTab;
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
		return this.manager.undo('TabbarOperations', window);
	},
 
	redo : function UT_redo() 
	{
		return this.manager.redo('TabbarOperations', window);
	},
 
	goToIndex : function UT_goToIndex(aIndex) 
	{
		return this.manager.goToIndex(aIndex, 'TabbarOperations', window);
	},
 
	getHistory : function UT_getHistory()
	{
		return this.manager.getHistory('TabbarOperations', window);
	},
 
	getId : function UT_getId(aTarget, aDefaultId)
	{
		return this.manager.getId(aTarget, aDefaultId);
	},
	getBindingParentId : function UT_getBindingParentId(aTarget, aDefaultId)
	{
		return this.manager.getBindingParentId(aTarget, aDefaultId);
	},
	getRelatedTargetsByIds : function UT_getRelatedTargetsByIds(aIds, aRootParent)
	{
		return this.manager.getRelatedTargetsByIds(aIds, aRootParent);
	},
 
	get isUndoable()
	{
		return (
			!this.manager.isUndoing('TabbarOperations', window) &&
			!this.manager.isRedoing('TabbarOperations', window)
		);
	},
 
	getTabOpetarionTargetsByIds : function UT_getTabOpetarionTargetsByIds(aWindoId, aParentId, aBrowserId, aTabIdOrIds) 
	{
		var targets = {
				window  : null,
				browser : null,
				parent  : null,
				tab     : null,
				tabs    : []
			};

		targets.window = aWindoId ?
				this.manager.getWindowById(aWindoId) :
				window ;
		if (!targets.window)
			return targets;

		var manager = targets.window['piro.sakura.ne.jp'].operationHistory;

		targets.parent = aParentId ?
				manager.getTargetById(aParentId, targets.window) :
				targets.window ;
		if (!targets.parent)
			return targets;

		targets.browser = aBrowserId ?
				manager.getTargetById(aBrowserId, targets.parent) :
				null ;
		if (!targets.browser || !aTabIdOrIds)
			return targets;

		if (typeof aTabIdOrIds == 'string') {
			targets.tab = targets.browser ?
				manager.getTargetById(aTabIdOrIds, targets.browser.mTabContainer) :
				null ;
			if (targets.tab)
				targets.tabs.push(targets.tab);
		}
		else if (aTabIdOrIds.length) {
			targets.tabs = targets.browser ?
				manager.getTargetsByIds.apply(manager, aTabIdOrIds.concat([targets.browser.mTabContainer])) :
				[] ;
			if (targets.tabs.length)
				targets.tab = targets.tabs[0];
		}
		return targets;
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
 
	updateMenuPopup : function UT_updateMenuPopup(aPopup) 
	{
		var separator = this.evaluateXPath(
				'descendant::xul:menuseparator[@class="undotab-history-clear-separator"]',
				aPopup,
				XPathResult.FIRST_ORDERED_NODE_TYPE
			).singleNodeValue;
		var clearItem = this.evaluateXPath(
				'descendant::xul:menuitem[@class="undotab-history-clear-item"]',
				aPopup,
				XPathResult.FIRST_ORDERED_NODE_TYPE
			).singleNodeValue;

		var range = document.createRange();
		range.selectNodeContents(aPopup);
		range.setEndBefore(separator);
		range.deleteContents();

		var fragment = document.createDocumentFragment();
		var history = this.getHistory();
		if (history.entries.length) {
			separator.removeAttribute('collapsed');
			clearItem.removeAttribute('collapsed');

			let current = history.index;
			history.entries
				.forEach(function(aEntry, aIndex) {
					var item = document.createElement('menuitem');
					item.setAttribute('label', aEntry.label);
					item.setAttribute('value', aIndex);
					item.setAttribute('type', 'radio');
					item.setAttribute('name', 'undotab-history-entry');
					if (aIndex == current) {
						item.setAttribute('checked', true);
					}
					else if (aIndex == current-1) {
						item.setAttribute('key', this.KEY_ID_PREFIX+'undo');
					}
					else if (aIndex == current+1) {
						item.setAttribute('key', this.KEY_ID_PREFIX+'redo');
					}
					fragment.insertBefore(item, fragment.firstChild);
				}, this);
		}
		else {
			separator.setAttribute('collapsed', true);
			clearItem.setAttribute('collapsed', true);

			let item = document.createElement('menuitem');
			item.setAttribute('label', this.bundle.getString('history_blank_label'));
			item.setAttribute('disabled', true);
			fragment.appendChild(item);
		}

		range.insertNode(fragment);
		range.detach();
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
			/(var tab = this.addTab\([^\;]+?\);)/,
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

		eval('aTabBrowser.loadTabs = '+aTabBrowser.loadTabs.toSource().replace(
			'if (aReplace) {',
			<![CDATA[
				UndoTabService.onLoadTabs(
					function() {
			$&]]>
		).replace(
			'if (!aLoadInBackground) {',
			<![CDATA[
					},
					this,
					arguments
				);
			$&]]>
		));

		if ('_beginRemoveTab' in aTabBrowser) { // Firefox 3.5 or later
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
		else { // Firefox 3.0
			eval('aTabBrowser.removeTab = '+aTabBrowser.removeTab.toSource().replace(
				/(([a-zA-Z0-9_]+).dispatchEvent\(([^\)]+)\);)/,
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

		eval('aTabBrowser.duplicateTab = '+aTabBrowser.duplicateTab.toSource().replace(
			'{',
			<![CDATA[{
				return UndoTabService.onDuplicateTab(
					function() {
			]]>
		).replace(
			/(\}\)?)$/,
			<![CDATA[
					},
					this,
					aTab
				);
			$1]]>
		));

		eval('aTabBrowser.removeAllTabsBut = '+aTabBrowser.removeAllTabsBut.toSource().replace(
			'{',
			<![CDATA[{
				return UndoTabService.onRemoveAllTabsBut(
					function() {
			]]>
		).replace(
			/(\}\)?)$/,
			<![CDATA[
					},
					this,
					aTab
				);
			$1]]>
		));

		if ('replaceTabWithWindow' in aTabBrowser) {
			eval('aTabBrowser.replaceTabWithWindow = '+aTabBrowser.replaceTabWithWindow.toSource().replace(
				'{',
				<![CDATA[{
					return UndoTabService.onNewWindowFromTab(
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

		if ('swapBrowsersAndCloseOther' in aTabBrowser) {
			eval('aTabBrowser.swapBrowsersAndCloseOther = '+aTabBrowser.swapBrowsersAndCloseOther.toSource().replace(
				'{',
				<![CDATA[{
					return UndoTabService.onSwapBrowsersAndCloseOther(
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
				/(var newTab)( = this.duplicateTab\(draggedTab\);.*?this.moveTabTo\(newTab, newIndex\);)/,
				<![CDATA[
					$1 = UndoTabService.onDuplicateTab(
						function() {
							$1$2
							return newTab;
						},
						this,
						draggedTab
					);
				]]>
			).replace(
				/(newTab = this.addTab\("about:blank"\);.*?this.swapBrowsersAndCloseOther\(newTab, draggedTab\);)/,
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
				/(newTab = this.loadOneTab\([^;]*\);.*?this.moveTabTo\([^;]*\);)/,
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

		if ('_onDragEnd' in aTabBrowser) {
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
	},
  
	destroy : function UT_destroy() 
	{
		this.destroyTabBrowser(gBrowser);
		window.addEventListener('mouseup', this, true);

		window.removeEventListener('unload', this, false);

		this.removePrefListener(this);
	},
	
	destroyTabBrowser : function UT_destroyTabBrowser(aTabBrowser) 
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

			case 'command':
				this.onMenuCommand(aEvent);
				break;

			case 'popupshowing':
				this.updateMenuPopup(aEvent.currentTarget);
				break;
		}
	},
 
	onMenuCommand : function UT_onMenuCommand(aEvent) 
	{
		var index = aEvent.target.getAttribute('value');
		if (index == 'clear') {
			this.getHistory().clear();
		}
		else {
			index = parseInt(index);
			if (!isNaN(index))
				this.goToIndex(index);
		}
	},
 
	onTabOpen : function UT_onTabOpen(aTask, aTabBrowser, aTab, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var parentId  = this.getBindingParentId(aTabBrowser);
		var browserId = this.getId(aTabBrowser);
		var tabId     = this.getId(aTab);
		var position;
		var selected;
		var session;

		this.manager.doUndoableTask(
			function(aInfo) {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-addTab',
				label  : this.bundle.getString('undo_addTab_label'),
				onUndo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId, tabId);
					if (!t.browser || !t.tab)
						return false;

					window['piro.sakura.ne.jp'].stopRendering.stop();

					session = UndoTabService.SessionStore.getTabState(t.tab);
					position = t.tab._tPos;
					selected = t.tab.selected;
					aInfo.manager.makeTabUnrecoverable(t.tab);
					t.browser.removeTab(t.tab);

					window.setTimeout(function() {
						window['piro.sakura.ne.jp'].stopRendering.start();
					}, 0);
				},
				onRedo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId);
					if (!t.browser)
						return false;

					window['piro.sakura.ne.jp'].stopRendering.stop();

					var tab = t.browser.addTab.apply(t.browser, aArguments);
					UndoTabService.SessionStore.setTabState(tab, session);
					session = undefined;
					tabId = aInfo.manager.getId(tab, tabId);

					t.browser.moveTabTo(tab, position);
					position = tab._tPos;

					if (selected)
						t.browser.selectedTab = tab;

					window.setTimeout(function() {
						window['piro.sakura.ne.jp'].stopRendering.start();
					}, 0);
				}
			}
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aTab        = undefined;
	},
 
	onLoadOneTab : function UT_onLoadOneTab(aTask, aTabBrowser, aTab, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var parentId  = this.getBindingParentId(aTabBrowser);
		var browserId = this.getId(aTabBrowser);
		var tabId;
		var selected;
		var position;

		var newTab;

		this.manager.doUndoableTask(
			function(aInfo) {
				newTab   = aTask.call(aTabBrowser);
				tabId    = aInfo.manager.getId(newTab);
				selected = newTab.selected;
				position = newTab._tPos;
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-loadOneTab',
				label  : this.bundle.getString('undo_loadOneTab_label'),
				onUndo : null,
				onRedo : null
			}
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aTab        = undefined;

		return newTab;
	},
 
	onLoadTabs : function UT_onLoadTabs(aTask, aTabBrowser, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var uris             = aArguments[0];
		var loadInBackgtound = aArguments[1];

		var parentId  = this.getBindingParentId(aTabBrowser);
		var browserId = this.getId(aTabBrowser);
		var currentTabState;
		var selectedTabId;
		var tabIds;

		var replace;

		this.manager.doUndoableTask(
			function(aInfo) {
				var beforeTabs = UndoTabService.getTabsArray(aTabBrowser);
				aTask.call(aTabBrowser);
				var tabs = UndoTabService.getTabsArray(aTabBrowser)
							.filter(function(aTab) {
								return beforeTabs.indexOf(aTab) < 0;
							});
				var replace = tabs.length - beforeTabs.length == uris.length - 1;
				if (replace) {
					currentTabState = UndoTabService.SessionStore.getTabState(aTabBrowser.selectedTab);
					tabs.unshift(aTabBrowser.selectedTab);
				}
				tabIds = tabs.map(function(aTab) {
						return aInfo.manager.getId(aTab);
					});
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-loadTabs',
				label  : this.bundle.getString('undo_loadTabs_label'),
				onUndo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId);
					if (!t.browser)
						return false;

					selectedTabId = aInfo.manager.getId(t.browser.selectedTab);
					if (replace)
						UndoTabService.SessionStore.setTabState(t.tab, currentTabState);
				},
				onRedo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId, tabIds);
					if (!t.browser || t.tabs.length != tabIds.length)
						return false;

					t.tabs.forEach(function(aTab, aIndex) {
						aTab.linkedBrowser.loadURI(uris[aIndex], null, null);
					});

					var selected = aInfo.manager.getTargetById(selectedTabId, t.browser);
					if (selected)
						t.browser.selectedTab = selected;
					selectedTabId = undefined;
				}
			}
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aArguments  = undefined;
	},
 
	onTabClose : function UT_onTabClose(aTask, aTabBrowser, aTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var parentId  = this.getBindingParentId(aTabBrowser);
		var browserId = this.getId(aTabBrowser);
		var tabId     = this.getId(aTab);
		var position  = aTab._tPos;
		var selected  = aTab.selected;
		var state     = this.SessionStore.getTabState(aTab);

		this.manager.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-removeTab',
				label  : this.bundle.getString('undo_removeTab_label'),
				onUndo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId);
					if (!t.browser)
						return false;

					window['piro.sakura.ne.jp'].stopRendering.stop();

					var tab = t.browser.addTab('about:blank');
					UndoTabService.SessionStore.setTabState(tab, state, false);
					tabId = aInfo.manager.getId(tab, tabId);

					t.browser.moveTabTo(tab, position);

					if (selected)
						t.browser.selectedTab = tab;

					window.setTimeout(function() {
						window['piro.sakura.ne.jp'].stopRendering.start();
					}, 0);
				},
				onRedo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId, tabId);
					if (!t.browser || !t.tab)
						return false;

					window['piro.sakura.ne.jp'].stopRendering.stop();

					position = t.tab._tPos;
					selected = t.tab.selected;
					state    = UndoTabService.SessionStore.getTabState(t.tab);
					aInfo.manager.makeTabUnrecoverable(t.tab);
					t.browser.removeTab(t.tab);

					window.setTimeout(function() {
						window['piro.sakura.ne.jp'].stopRendering.start();
					}, 0);
				}
			}
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aTab        = undefined;
	},
 
	onTabMove : function UT_onTabMove(aTask, aTabBrowser, aTab, aOldPosition) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var parentId    = this.getBindingParentId(aTabBrowser);
		var browserId   = this.getId(aTabBrowser);
		var tabId       = this.getId(aTab);
		var newPosition = aTab._tPos;
		var oldPosition = aOldPosition;

		this.manager.doUndoableTask(
			function() {
				aTask.call(aTabBrowser);
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-moveTab',
				label  : this.bundle.getString('undo_moveTab_label'),
				onUndo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId, tabId);
					if (!t.browser || !t.tab)
						return false;

					t.browser.moveTabTo(t.tab, oldPosition);
					oldPosition = t.tab._tPos;
				},
				onRedo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId, tabId);
					if (!t.browser || !t.tab)
						return false;

					t.browser.moveTabTo(t.tab, newPosition);
					newPosition = t.tab._tPos;
				}
			}
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aTab        = undefined;
		aOldPosition = undefined;
	},
 
	onDuplicateTab : function UT_onDuplicateTab(aTask, aTabBrowser, aTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var b = this.getTabBrowserFromChild(aTab);
		var remoteWindowId  = this.getId(b.ownerDocument.defaultView);
		var remoteParentId  = this.getBindingParentId(b);
		var remoteBrowserId = this.getId(b);
		var remoteTabId     = this.getId(aTab);
		b = undefined;

		var ourParentId  = this.getBindingParentId(aTabBrowser);
		var ourBrowserId = this.getId(aTabBrowser);
		var ourTabId;
		var ourPosition = -1;
		var ourSelected = false;

		var newTab;

		this.manager.doUndoableTask(
			function(aInfo) {
				newTab = aTask.call(aTabBrowser);
				if (newTab) {
					ourTabId = aInfo.manager.getId(newTab);
					ourPosition = newTab._tPos;
				}
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-duplicateTab',
				label  : this.bundle.getString('undo_duplicateTab_label'),
				onUndo : function(aInfo) {
					var our = UndoTabService.getTabOpetarionTargetsByIds(null, ourParentId, ourBrowserId, ourTabId);
					if (!our.browser || !our.tab)
						return false;

					ourSelected = our.tab.selected;
					aInfo.manager.makeTabUnrecoverable(our.tab);
					our.browser.removeTab(our.tab);
				},
				onRedo : function(aInfo) {
					var remote = UndoTabService.getTabOpetarionTargetsByIds(remoteWindowId, remoteParentId, remoteBrowserId, remoteTabId);
					if (!remote.window || !remote.browser || !remote.tab)
						return false;

					var our = UndoTabService.getTabOpetarionTargetsByIds(null, ourParentId, ourBrowserId, ourTabId);
					if (!our.browser || !our.tab)
						return false;

					var tab = our.browser.duplicateTab(remote.tab);
					if (ourPosition > -1)
						our.browser.moveTabTo(tab, ourPosition);
					ourPosition = tab._tPos;
					if (ourSelected)
						our.browser.selectedTab = tab;
				}
			}
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aTab        = undefined;

		return newTab;
	},
 
	onRemoveAllTabsBut : function UT_onRemoveAllTabsBut(aTask, aTabBrowser, aStayedTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var parentId      = this.getBindingParentId(aTabBrowser);
		var browserId     = this.getId(aTabBrowser);
		var selectedTabId = this.getId(aTabBrowser.selectedTab);
		var selectedTabPosition = aTabBrowser.selectedTab._tPos;

		var retVal;
		this.manager.doUndoableTask(
			function(aInfo) {
				var count = UndoTabService.getTabs(aTabBrowser).snapshotLength;
				retVal = aTask.call(aTabBrowser);

				return UndoTabService.getTabs(aTabBrowser).snapshotLength != count;
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-removeAllTabsBut',
				label  : this.bundle.getString('undo_removeAllTabsBut_label'),
				onUndo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId, selectedTabId);
					if (!t.browser || !t.tab)
						return false;

					t.browser.selectedTab = t.tab;
					selectedTabId = undefined;

					t.browser.moveTabTo(t.tab, selectedTabPosition);
					selectedTabPosition = undefined;
				},
				onRedo : function(aInfo) {
					var t = UndoTabService.getTabOpetarionTargetsByIds(null, parentId, browserId);
					if (!t.browser)
						return false;

					selectedTabId = aInfo.manager.getId(t.browser.selectedTab);
					selectedTabPosition = t.browser.selectedTab._tPos;
				}
			}
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aStayedTab  = undefined;

		return retVal;
	},
 
	onSwapBrowsersAndCloseOther : function UT_onSwapBrowsersAndCloseOther(aTask, aTabBrowser, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var ourTab       = aArguments[0];
		var ourTabId     = this.getId(ourTab);
		var ourBrowser   = this.getTabBrowserFromChild(ourTab);
		var ourBrowserId = this.getId(ourBrowser);
		var ourParentId  = this.getBindingParentId(ourBrowser);
		var ourWindowId  = this.manager.getWindowId(ourTab.ownerDocument.defaultView);
		var ourSelected  = this.getId(ourBrowser.selectedTab);

		var remoteTab       = aArguments[0];
		var remoteTabId     = this.getId(remoteTab);
		var remoteBrowser   = this.getTabBrowserFromChild(remoteTab);
		var remoteBrowserId = this.getId(remoteBrowser);
		var remoteParentId  = this.getBindingParentId(remoteBrowser);
		var remoteWindowId  = this.manager.getWindowId(remoteTab.ownerDocument.defaultView);
		var remoteSelected  = this.getId(remoteBrowser.selectedTab);

		var ourEntry = {
				name   : 'undotab-swapBrowsersAndCloseOther',
				label  : this.bundle.getString('undo_swapBrowsersAndCloseOther_our_label'),
				onUndo : function(aInfo) {
					var our = UndoTabService.getTabOpetarionTargetsByIds(ourWindowId, ourParentId, ourBrowserId, ourTabId);
					if (!our.window || !our.browser || !our.tab)
						return false;

					var remote = UndoTabService.getTabOpetarionTargetsByIds(remoteWindowId, remoteParentId, remoteBrowserId, remoteTabId);
					if (!remote.window || !remote.window.closed) {
						// The remote window was closed automatically.
						// So, we have to reopen the window.
						var continuation = aInfo.getContinuation();
						;
						var remoteWindow = our.browser.replaceTabWithWindow(our.tab);
						remoteWindow.addEventListener('load', function() {
							remoteWindow.removeEventListener('load', arguments.callee, false);
							remoteWindowId = aInfo.manager.setWindowId(remoteWindow, remoteWindowId);
							remoteWindow.setTimeout(function() {
								var b = remoteWindow.gBrowser;
								aInfo.manager.setElementId(b.selectedTab, remoteTabId);
								aInfo.manager.setElementId(b, remoteBrowserId);
								aInfo.manager.setBindingParentId(b, remoteParentId);
								continuation();
								aInfo.manager.addEntry('TabbarOperations', remoteWindow, remoteEntry);
							}, 10);
						}, false);
					}
					else {
						aInfo.manager.syncWindowHistoryFocus({
							currentEntry : this,
							name    : 'TabbarOperations',
							entries : [ourEntry, remoteEntry],
							windows : [our.window, remote.window]
						});

						var selected = aInfo.getTargetById(ourSelected, our.browser.mTabContainer);
						if (selected)
							our.browser.selectedTab = selected;

						var continuation = aInfo.getContinuation();
						our.window.setTimeout(function() {
							var tab = remote.browser.addTab('about:blank');
							aInfo.manager.setElementId(tab, remoteTabId);
							tab.linkedBrowser.stop();
							tab.linkedBrowser.docShell;
							remote.browser.swapBrowsersAndCloseOther(tab, our.tab);
							var selected = aInfo.getTargetById(remoteSelected, remote.browser.mTabContainer);
							if (selected)
								remote.browser.selectedTab = selected;
							continuation();
						}, 10);
					}
				},
				onRedo : function(aInfo) {
					var our = UndoTabService.getTabOpetarionTargetsByIds(ourWindowId, ourParentId, ourBrowserId, ourTabId);
					if (!our.window || !our.browser || !our.tab)
						return false;
					var remote = UndoTabService.getTabOpetarionTargetsByIds(remoteWindowId, remoteParentId, remoteBrowserId, remoteTabId);
					if (!remote.window || !remote.browser || !remote.tab)
						return false;

					aInfo.manager.syncWindowHistoryFocus({
						currentEntry : this,
						name    : 'TabbarOperations',
						entries : [ourEntry, remoteEntry],
						windows : [our.window, remote.window]
					});

					var willClose = remote.browser.mTabContainer.childNodes.length == 1;

					aInfo.manager.makeTabUnrecoverable(our.tab); // ensure it is a blank tab
					our.tab.linkedBrowser.stop();
					our.tab.linkedBrowser.docShell;
					remote.browser.swapBrowsersAndCloseOther(our.tab, remote.tab);

					ourSelected = aInfo.manager.getId(our.browser.selectedTab);
					if (!willClose)
						remoteSelected = aInfo.manager.getId(remote.browser.selectedTab);
				}
			};
		var remoteEntry = {
				__proto__ : ourEntry,
				label     : this.bundle.getString('undo_swapBrowsersAndCloseOther_remote_label')
			};

		var retVal;
		this.manager.doUndoableTask(
			function(aInfo) {
				aInfo.manager.doUndoableTask(
					function(aInfo) {
						retVal = aTask.call(aTabBrowser);
					},
					'TabbarOperations',
					window,
					ourEntry
				);
			},
			'TabbarOperations',
			remoteTab.ownerDocument.defaultView,
			remoteEntry
		);

		aTask       = undefined;
		aTabBrowser = undefined;
		aArguments  = undefined;

		ourTab     = undefined;
		ourBrowser = undefined;
		remoteTab     = undefined;
		remoteBrowser = undefined;

		return retVal;
	},
 
	importTabOnDrop : function UT_importTabOnDrop(aTask, aTabBrowser, aDraggedTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var targetId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(window);
		var targetTabPosition = -1;

		var remoteId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(aDraggedTab.ownerDocument.defaultView);
		var remoteTabPosition = aDraggedTab._tPos;
		var remoteTabSelected = aDraggedTab.selected;

		var targetEntry = {
				name   : 'undotab-onDrop-importTab',
				label  : this.bundle.getString('undo_importTabOnDrop_target_label'),
				onUndo : function(aInfo) {
					if (aInfo.processed) return;

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
									continuation();
									aInfo.manager.addEntry(
										'TabbarOperations',
										remoteWindow,
										remoteEntry
									);
									aInfo.manager.syncWindowHistoryFocus({
										currentEntry : targetEntry,
										name    : 'TabbarOperations',
										entries : [targetEntry, remoteEntry],
										windows : [targetWindow, remoteWindow]
									});
								}, 0);
							}, false);
						}, 0);
					}
					else {
						aInfo.manager.syncWindowHistoryFocus({
							currentEntry : this,
							name    : 'TabbarOperations',
							entries : [targetEntry, remoteEntry],
							windows : [targetWindow, remoteWindow]
						});
						let remoteBrowser = remoteWindow.gBrowser;
						let remoteTab = remoteWindow.UndoTabService.importTabTo(targetTab, remoteBrowser);
						remoteBrowser.moveTabTo(remoteTab, remoteTabPosition);
						if (remoteTabSelected)
							remoteBrowser.selectedTab = remoteTab;
					}
				},
				onRedo : function(aInfo) {
					if (aInfo.processed) return;

					var targetWindow = aInfo.manager.getWindowById(targetId);
					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					if (!targetWindow || !remoteWindow) return false;

					aInfo.manager.syncWindowHistoryFocus({
						currentEntry : this,
						name    : 'TabbarOperations',
						entries : [targetEntry, remoteEntry],
						windows : [targetWindow, remoteWindow]
					});

					var targetBrowser = aTabBrowser && aTabBrowser.parentNode ? aTabBrowser : targetWindow.gBrowser;
					var remoteBrowser = remoteWindow.gBrowser;
					var remoteTab = remoteWindow.UndoTabService.getTabAt(remoteTabPosition, remoteBrowser);

					var isLast = remoteWindow.UndoTabService.getTabs(remoteBrowser).length == 1;
					if (isLast)
						remoteBrowser.addTab('about:blank');

					var targetTab = targetWindow.UndoTabService.importTabTo(remoteTab, targetBrowser);
					targetBrowser.moveTabTo(targetTab, targetTabPosition);
					if (remoteTabSelected)
						targetBrowser.selectedTab = targetTab;

					if (isLast) {
						let continuation = aInfo.getContinuation();
						remoteWindow.setTimeout(function() {
							remoteWindow.close();
							continuation();
						}, 0);
					}
				}
			};
		var remoteEntry = {
				__proto__ : targetEntry,
				label     : this.bundle.getString('undo_importTabOnDrop_remote_label')
			};

		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				var remoteWindow = aInfo.manager.getWindowById(remoteId);
				// We have to do this operation as an undoable task in the remote window!
				aInfo.manager.doUndoableTask(
					function(aInfo) {
						targetTabPosition = aTask.call(aTabBrowser)._tPos;
					},
					'TabbarOperations',
					remoteWindow,
					remoteEntry
				);
			},

			'TabbarOperations',
			window,
			targetEntry
		);
		aDraggedTab = null;
	},
 
	openNewTabOnDrop : function UT_openNewTabOnDrop(aTask, aTabBrowser) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var position = -1;
		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				if (aInfo.processed) return;
				position = aTask.call(aTabBrowser)._tPos;
			},

			'TabbarOperations',
			window,
			{
				name   : 'undotab-onDrop-addTab',
				label  : this.bundle.getString('undo_addTabOnDrop_label'),
				onUndo : function(aInfo) {
					if (aInfo.processed) return;
					var tab = UndoTabService.getTabAt(position, aTabBrowser);
					aInfo.manager.makeTabUnrecoverable(tab);
					aTabBrowser.removeTab(tab);
				}
			}
		);
	},
 
	onNewWindowFromTab : function UT_onNewWindowFromTab(aTask, aTabBrowser, aTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var sourceId = window['piro.sakura.ne.jp'].operationHistory.getWindowId(window);
		var remoteId;
		var position = aTab._tPos;
		var selected = aTab.selected;
		var newWindow;

		var targetEntry = {
				name   : 'undotab-onDragEnd-tearOffTab',
				label  : this.bundle.getString('undo_newWindowFromTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.processed) return;

					var remoteWindow = aInfo.manager.getWindowById(remoteId);
					var targetWindow = aInfo.manager.getWindowById(sourceId);
					if (!targetWindow || !remoteWindow) return false;

					aInfo.manager.syncWindowHistoryFocus({
						currentEntry : this,
						name    : 'TabbarOperations',
						entries : [targetEntry, remoteEntry],
						windows : [targetWindow, remoteWindow]
					});

					var targetBrowser = aTabBrowser && aTabBrowser.parentNode ? aTabBrowser : targetWindow.gBrowser;
					var remoteTab = remoteWindow.gBrowser.selectedTab;
					var targetTab = targetWindow.UndoTabService.importTabTo(remoteTab, targetBrowser);
					targetBrowser.moveTabTo(targetTab, position);
					position = targetTab._tPos;
					if (selected)
						targetBrowser.selectedTab = targetTab;
				},
				onRedo : function(aInfo) {
					if (aInfo.processed) return;

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
									remoteEntry
								);
							}, 0);
						}, false);
					}, 0);
				}
			};
		var remoteEntry = { __proto__ : targetEntry };


		window['piro.sakura.ne.jp'].operationHistory.doUndoableTask(
			function(aInfo) {
				var continuation = aInfo.getContinuation();
				newWindow = aTask.call(aTabBrowser);
				newWindow.addEventListener('load', function() {
					newWindow.removeEventListener('load', arguments.callee, false);
					remoteId = aInfo.manager.getWindowId(newWindow);
					newWindow.setTimeout(function() { // wait for tab swap
						aInfo.manager.addEntry(
							'TabbarOperations',
							newWindow,
							remoteEntry
						);
						continuation();
					}, 0);
				}, false);
			},

			'TabbarOperations',
			window,
			targetEntry
		);
		return newWindow;
	},
 
	onUndoCloseTab : function UT_onUndoCloseTab(aTask, aThis, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aThis);

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
				name   : 'undotab-undoCloseTab',
				label  : this.bundle.getString('undo_undoCloseTab_label'),
				onUndo : function(aInfo) {
					if (aInfo.processed) return;

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
					if (aInfo.processed) return;

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
  
