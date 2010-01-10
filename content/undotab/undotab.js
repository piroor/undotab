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
 
	makeTabBlank : function UT_makeTabBlank(aTab)
	{
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

		delete aTab.linkedBrowser.parentNode.__SS_data;
		delete aTab.__SS_extdata;
	},
 
	irrevocableRemoveTab : function UT_irrevocableRemoveTab(aTab, aTabBrowser)
	{
		// nsSessionStore.js doesn't save the tab to the undo cache
		// if the tab is completely blank.
		this.makeTabBlank(aTab);

		// override session data to prevent undo
		aTab.linkedBrowser.parentNode.__SS_data = {
			entries : [],
			_tabStillLoading : true, // for Firefox 3.5 or later
			_tab : aTab // for Firefox 3.0.x
		};

		(aTabBrowser || this.getTabBrowserFromChild(aTab))
			.removeTab(aTab);
	},
 
	getTabState : function UT_getTabState(aTab) 
	{
		return this.SessionStore.getTabState(aTab);
	},
 
	setTabState : function UT_setTabState(aTab, aState) 
	{
		return this.SessionStore.setTabState(aTab, aState);
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
 
	get isUndoable()
	{
		return (
			!this.manager.isUndoing('TabbarOperations', window) &&
			!this.manager.isRedoing('TabbarOperations', window)
		);
	},
 
	getTabOpetarionTargets : function UT_getTabOpetarionTargets(aData) 
	{
		var targets = {
				window  : null,
				browser : null,
				parent  : null,
				tab     : null,
				tabs    : []
			};

		targets.window = aData.window ?
				this.manager.getWindowById(aData.window) :
				window ;
		if (!targets.window)
			return targets;

		var manager = targets.window['piro.sakura.ne.jp'].operationHistory;

		targets.parent = aData.parent ?
				manager.getTargetById(aData.parent, targets.window) :
				targets.window ;
		if (!targets.parent)
			return targets;

		targets.browser = aData.browser ?
				manager.getTargetById(aData.browser, targets.parent) :
				null ;
		if (!targets.browser || (!aData.tab && !aData.tabs))
			return targets;

		if (aData.tab) {
			targets.tab = targets.browser ?
				manager.getTargetById(aData.tab, targets.browser.mTabContainer) :
				null ;
			if (targets.tab)
				targets.tabs.push(targets.tab);
		}
		else if (aData.tabs && aData.tabs.length) {
			targets.tabs = targets.browser ?
				manager.getTargetsByIds.apply(manager, aData.tabs.concat([targets.browser.mTabContainer])) :
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
		window.addEventListener('UIOperationHistoryUndo:TabbarOperations', this, false);
		window.addEventListener('UIOperationHistoryRedo:TabbarOperations', this, false);

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
					return UndoTabService.onTearOffTab(
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
				/(newTab = this.addTab\("about:blank"\);.*?this.swapBrowsersAndCloseOther\(newTab, draggedTab\);.*?this.selectedTab = newTab;)/,
				<![CDATA[
					UndoTabService.importTabOnDrop(
						function() {
							$1
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
						},
						this
					);
				]]>
			));
		}
	},
  
	destroy : function UT_destroy() 
	{
		this.destroyTabBrowser(gBrowser);

		window.removeEventListener('unload', this, false);

		window.removeEventListener('UIOperationHistoryUndo:TabbarOperations', this, false);
		window.removeEventListener('UIOperationHistoryRedo:TabbarOperations', this, false);

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

			case 'UIOperationHistoryUndo:TabbarOperations':
				switch(aEvent.entry.name)
				{
					case 'undotab-addTab':    return this.onUndoTabOpen(aEvent);
					case 'undotab-loadTabs':  return this.onUndoLoadTabs(aEvent);
					case 'undotab-removeTab': return this.onUndoTabClose(aEvent);
					case 'undotab-moveTab':   return this.onUndoTabMove(aEvent);
					case 'undotab-duplicateTab':     return this.onUndoDuplicateTab(aEvent);
					case 'undotab-removeAllTabsBut': return this.onUndoRemoveAllTabsBut(aEvent);
					case 'undotab-swapBrowsersAndCloseOther-our':
					case 'undotab-swapBrowsersAndCloseOther-remote':
							return this.onUndoSwapBrowsersAndCloseOther(aEvent);
					case 'undotab-onDrop-importTab-our':
					case 'undotab-onDrop-importTab-remote':
							return this.onUndoImportTabOnDrop(aEvent);
					case 'undotab-tearOffTab-our':
					case 'undotab-tearOffTab-remote':
							return this.onUndoTearOffTab(aEvent);
				}
				break;

			case 'UIOperationHistoryRedo:TabbarOperations':
				switch(aEvent.entry.name)
				{
					case 'undotab-addTab':    return this.onRedoTabOpen(aEvent);
					case 'undotab-loadTabs':  return this.onRedoLoadTabs(aEvent);
					case 'undotab-removeTab': return this.onRedoTabClose(aEvent);
					case 'undotab-moveTab':   return this.onRedoTabMove(aEvent);
					case 'undotab-duplicateTab':     return this.onRedoDuplicateTab(aEvent);
					case 'undotab-removeAllTabsBut': return this.onRedoRemoveAllTabsBut(aEvent);
					case 'undotab-swapBrowsersAndCloseOther-our':
					case 'undotab-swapBrowsersAndCloseOther-remote':
							return this.onRedoSwapBrowsersAndCloseOther(aEvent);
					case 'undotab-onDrop-importTab-our':
					case 'undotab-onDrop-importTab-remote':
							return this.onRedoImportTabOnDrop(aEvent);
					case 'undotab-tearOffTab-our':
					case 'undotab-tearOffTab-remote':
							return this.onRedoTearOffTab(aEvent);
				}
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

		this.manager.doOperation(
			function(aInfo) {
				aTask.call(aTabBrowser);
			},
			'TabbarOperations',
			window,
			{
				name  : 'undotab-addTab',
				label : this.bundle.getString('undo_addTab_label'),
				data  : {
					parent    : this.manager.getBindingParentId(aTabBrowser),
					browser   : this.manager.getId(aTabBrowser),
					tab       : this.manager.getId(aTab),
					state     : this.getTabState(aTab),
					arguments : aArguments
				}
			}
		);
	},
	onUndoTabOpen : function UT_onUndoTabOpen(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser || !target.tab)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		data.state = this.getTabState(target.tab);
		data.position = target.tab._tPos;
		data.isSelected = target.tab.selected;
		this.irrevocableRemoveTab(target.tab, target.browser);

		window.setTimeout(function() {
			window['piro.sakura.ne.jp'].stopRendering.start();
		}, 0);
	},
	onRedoTabOpen : function UT_onRedoTabOpen(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		var tab = target.browser.addTab.apply(target.browser, data.arguments);
		this.setTabState(tab, data.state);
		data.tab = this.manager.setElementId(tab, data.tab);

		target.browser.moveTabTo(tab, data.position);
		data.position = tab._tPos;

		if (data.isSelected)
			target.browser.selectedTab = tab;

		window.setTimeout(function() {
			window['piro.sakura.ne.jp'].stopRendering.start();
		}, 0);
	},
 
	onLoadTabs : function UT_onLoadTabs(aTask, aTabBrowser, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var data = {
				uris : Array.slice(aArguments[0]),

				parent  : this.manager.getBindingParentId(aTabBrowser),
				browser : this.manager.getId(aTabBrowser),
				tabs    : [],

				currentTabState : null,
				selected        : null,
				replace         : false
			};

		this.manager.doOperation(
			function(aInfo) {
				var beforeTabs = UndoTabService.getTabsArray(aTabBrowser);
				aTask.call(aTabBrowser);
				var tabs = UndoTabService.getTabsArray(aTabBrowser)
							.filter(function(aTab) {
								return beforeTabs.indexOf(aTab) < 0;
							});
				data.replace = (data.uris.length - tabs.length) == 1;
				if (data.replace) {
					data.currentTabState = UndoTabService.getTabState(aTabBrowser.selectedTab);
					tabs.unshift(aTabBrowser.selectedTab);
				}
				data.tabs = tabs.map(function(aTab) {
						return aInfo.manager.getId(aTab);
					});
			},
			'TabbarOperations',
			window,
			{
				name  : 'undotab-loadTabs',
				label : this.bundle.getString('undo_loadTabs_label'),
				data  : data
			}
		);
	},
	onUndoLoadTabs : function UT_onUndoLoadTabs(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser)
			return aEvent.preventDefault();

		data.selected = this.manager.getId(target.browser.selectedTab);
		if (data.replace)
			this.setTabState(target.tab, data.currentTabState);
	},
	onRedoLoadTabs : function UT_onRedoLoadTabs(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser || target.tabs.length != data.tabs.length)
			return aEvent.preventDefault();

		target.tabs.forEach(function(aTab, aIndex) {
			aTab.linkedBrowser.loadURI(data.uris[aIndex], null, null);
		});

		var selected = this.manager.getTargetById(data.selectedTab, target.browser);
		if (selected)
			target.browser.selectedTab = selected;
	},
 
	onTabClose : function UT_onTabClose(aTask, aTabBrowser, aTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		this.manager.doOperation(
			function() {
				aTask.call(aTabBrowser);
			},
			'TabbarOperations',
			window,
			{
				name  : 'undotab-removeTab',
				label : this.bundle.getString('undo_removeTab_label'),
				data  : {
					parent  : this.manager.getBindingParentId(aTabBrowser),
					browser : this.manager.getId(aTabBrowser),
					tab     : this.manager.getId(aTab),

					position   : aTab._tPos,
					isSelected : aTab.selected,
					state      : this.getTabState(aTab)
				}
			}
		);
	},
	onUndoTabClose : function UT_onUndoTabClose(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		var tab = target.browser.addTab('about:blank');
		this.setTabState(tab, data.state);
		data.tab = this.manager.setElementId(tab, data.tab);

		target.browser.moveTabTo(tab, data.position);

		if (data.isSelected)
			target.browser.selectedTab = tab;

		window.setTimeout(function() {
			window['piro.sakura.ne.jp'].stopRendering.start();
		}, 0);
	},
	onRedoTabClose : function UT_onRedoTabClose(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser || !target.tab)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		data.position   = target.tab._tPos;
		data.isSelected = target.tab.selected;
		data.state      = this.getTabState(target.tab);
		this.irrevocableRemoveTab(target.tab, target.browser);

		window.setTimeout(function() {
			window['piro.sakura.ne.jp'].stopRendering.start();
		}, 0);
	},
 
	onTabMove : function UT_onTabMove(aTask, aTabBrowser, aTab, aOldPosition) 
	{
		if (!this.isUndoable || aTab._tPos == aOldPosition)
			return aTask.call(aTabBrowser);

		this.manager.doOperation(
			function() {
				aTask.call(aTabBrowser);
			},
			'TabbarOperations',
			window,
			{
				name  : 'undotab-moveTab',
				label : this.bundle.getString('undo_moveTab_label'),
				data  : {
					parent  : this.manager.getBindingParentId(aTabBrowser),
					browser : this.manager.getId(aTabBrowser),
					tab     : this.manager.getId(aTab),

					newPosition : aTab._tPos,
					oldPosition : aOldPosition
				}
			}
		);
	},
	onUndoTabMove : function UT_onUndoTabMove(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser || !target.tab)
			return aEvent.preventDefault();

		target.browser.moveTabTo(target.tab, data.oldPosition);
		data.oldPosition = target.tab._tPos;
	},
	onRedoTabMove : function UT_onRedoTabMove(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser || !target.tab)
			return aEvent.preventDefault();

		target.browser.moveTabTo(target.tab, data.newPosition);
		data.newPosition = target.tab._tPos;
	},
 
	onDuplicateTab : function UT_onDuplicateTab(aTask, aTabBrowser, aTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var b = this.getTabBrowserFromChild(aTab);
		var data = {
				remote : {
					window  : this.manager.getId(b.ownerDocument.defaultView),
					parent  : this.manager.getBindingParentId(b),
					browser : this.manager.getId(b),
					tab     : this.manager.getId(aTab)
				},
				our : {
					parent  : this.manager.getBindingParentId(aTabBrowser),
					browser : this.manager.getId(aTabBrowser),
					tab     : null,

					position   : -1,
					isSelected : false
				}
			};

		var newTab;

		this.manager.doOperation(
			function(aInfo) {
				newTab = aTask.call(aTabBrowser);
				if (newTab) {
					data.our.tab = aInfo.manager.getId(newTab);
					data.our.tab.position = newTab._tPos;
				}
			},
			'TabbarOperations',
			window,
			{
				name  : 'undotab-duplicateTab',
				label : this.bundle.getString('undo_duplicateTab_label'),
				data  : data
			}
		);
		return newTab;
	},
	onUndoDuplicateTab : function UT_onUndoDuplicateTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargets(data.our);
		if (!our.browser || !our.tab)
			return aEvent.preventDefault();

		data.our.isSelected = our.tab.selected;
		this.irrevocableRemoveTab(our.tab, our.browser);
	},
	onRedoDuplicateTab : function UT_onRedoDuplicateTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var remote = this.getTabOpetarionTargets(data.remote);
		if (!remote.window || !remote.browser || !remote.tab)
			return aEvent.preventDefault();

		var our = this.getTabOpetarionTargets(data.our);
		if (!our.browser || !our.tab)
			return aEvent.preventDefault();

		var tab = our.browser.duplicateTab(remote.tab);
		data.our.tab = this.manager.setElementId(tab, data.our.tab);

		if (data.our.position > -1)
			our.browser.moveTabTo(tab, data.our.position);
		data.our.position = tab._tPos;

		if (data.our.isSelected)
			our.browser.selectedTab = tab;
	},
 
	onRemoveAllTabsBut : function UT_onRemoveAllTabsBut(aTask, aTabBrowser, aStayedTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var retVal;
		this.manager.doOperation(
			function(aInfo) {
				var count = UndoTabService.getTabs(aTabBrowser).snapshotLength;
				retVal = aTask.call(aTabBrowser);

				// don't register if the operation is canceled.
				return UndoTabService.getTabs(aTabBrowser).snapshotLength != count;
			},
			'TabbarOperations',
			window,
			{
				name  : 'undotab-removeAllTabsBut',
				label : this.bundle.getString('undo_removeAllTabsBut_label'),
				data  : {
					parent  : this.manager.getBindingParentId(aTabBrowser),
					browser : this.manager.getId(aTabBrowser),
					tab     : this.manager.getId(aTabBrowser.selectedTab),

					position : aTabBrowser.selectedTab._tPos
				}
			}
		);
		return retVal;
	},
	onUndoRemoveAllTabsBut : function UT_onUndoRemoveAllTabsBut(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser || !target.tab)
			return aEvent.preventDefault();

		if (target.tab) {
			target.browser.selectedTab = target.tab;
			target.browser.moveTabTo(target.tab, data.position);
		}
	},
	onRedoRemoveAllTabsBut : function UT_onRedoRemoveAllTabsBut(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargets(data);
		if (!target.browser)
			return aEvent.preventDefault();

		data.tab = this.manager.getId(target.browser.selectedTab);
		data.position = target.browser.selectedTab._tPos;
	},
 
	onSwapBrowsersAndCloseOther : function UT_onSwapBrowsersAndCloseOther(aTask, aTabBrowser, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var ourTab     = aArguments[0];
		var ourBrowser = this.getTabBrowserFromChild(ourTab);
		var ourWindow  = ourTab.ownerDocument.defaultView;

		var remoteTab     = aArguments[1];
		var remoteBrowser = this.getTabBrowserFromChild(remoteTab);
		var remoteWindow  = remoteTab.ownerDocument.defaultView;

		var data = {
				our : {
					tab     : this.manager.getId(ourTab),
					browser : this.manager.getId(ourBrowser),
					parent  : this.manager.getBindingParentId(ourBrowser),
					window  : this.manager.getId(ourWindow),
					selected : this.manager.getId(ourBrowser.selectedTab)
				},
				remote : {
					tab     : this.manager.getId(remoteTab),
					browser : this.manager.getId(remoteBrowser),
					parent  : this.manager.getBindingParentId(remoteBrowser),
					window  : this.manager.getId(remoteWindow),
					selected  : this.manager.getId(remoteBrowser.selectedTab),
					width  : remoteWindow.outerWidth,
					height : remoteWindow.outerHeight,
					x      : remoteWindow.screenX,
					y      : remoteWindow.screenY
				}
			};

		data.our.entry = {
			name  : 'undotab-swapBrowsersAndCloseOther-our',
			label : this.bundle.getString('undo_swapBrowsersAndCloseOther_our_label'),
			data  : data
		};
		data.remote.entry = {
			name  : 'undotab-swapBrowsersAndCloseOther-remote',
			label : this.bundle.getString('undo_swapBrowsersAndCloseOther_remote_label'),
			data  : data
		};

		var retVal;
		if (remoteWindow == ourWindow) {
			this.manager.doOperation(
				function(aInfo) {
					retVal = aTask.call(aTabBrowser);
				},
				'TabbarOperations',
				ourWindow,
				data.our.entry
			);
		}
		else {
			this.manager.doOperation(
				function(aInfo) {
					// We have to do this operation as an undoable task in the remote window!
					aInfo.manager.doOperation(
						function(aInfo) {
							retVal = aTask.call(aTabBrowser);
						},
						'TabbarOperations',
						remoteWindow,
						data.remote.entry
					);
				},
				'TabbarOperations',
				ourWindow,
				data.our.entry
			);
		}
		return retVal;
	},
	onUndoSwapBrowsersAndCloseOther : function UT_onUndoSwapBrowsersAndCloseOther(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargets(data.our);
		if (!our.window || !our.browser || !our.tab)
			return aEvent.preventDefault();

		var remote = this.getTabOpetarionTargets(data.remote);
		if (!remote.window || remote.window.closed) {
			// The remote window was closed automatically.
			// So, we have to reopen the window.
			var continuation = aEvent.getContinuation();
			var remoteWindow = our.browser.replaceTabWithWindow(our.tab);
			remoteWindow.addEventListener('load', function() {
				remoteWindow.removeEventListener('load', arguments.callee, false);
				data.remote.window = aEvent.manager.setWindowId(remoteWindow, data.remote.window);
				remoteWindow.setTimeout(function() {
					var b = remoteWindow.gBrowser;
					aEvent.manager.setElementId(b.selectedTab, data.remote.tab);
					aEvent.manager.setElementId(b, data.remote.browser);
					aEvent.manager.setBindingParentId(b, data.remote.parent);
					remoteWindow.resizeTo(data.remote.width, data.remote.height);
					remoteWindow.moveTo(data.remote.x, data.remote.y);
					continuation();
					// We have to register new entry with delay, because
					// the state of the manager is still "undoing" when
					// just after continuation() is called.
					remoteWindow.setTimeout(function() {
						aEvent.manager.addEntry('TabbarOperations', remoteWindow, data.remote.entry);
						aEvent.manager.fakeUndo('TabbarOperations', remoteWindow, data.remote.entry);
					}, 250);
				}, 10);
			}, false);
			return;
		}

		if (entry == data.our.entry)
			this.manager.fakeUndo('TabbarOperations', remote.window, data.remote.entry);
		else
			this.manager.fakeUndo('TabbarOperations', our.window, data.our.entry);

		var selected = this.manager.getTargetById(data.our.selected, our.browser.mTabContainer);
		if (selected)
			our.browser.selectedTab = selected;

		if (remote.tab) { // reuse the tab restored by onUndo() of remoteTab()
			this.makeTabBlank(remote.tab);
		}
		else {
			remote.tab = remote.browser.addTab('about:blank');
			this.manager.setElementId(remote.tab, data.remote.tab);
		}
		remote.tab.linkedBrowser.stop();
		remote.tab.linkedBrowser.docShell;
		remote.browser.swapBrowsersAndCloseOther(remote.tab, our.tab);

		selected = this.manager.getTargetById(data.remote.selected, remote.browser.mTabContainer);
		if (selected)
			remote.browser.selectedTab = selected;
	},
	onRedoSwapBrowsersAndCloseOther : function UT_onRedoSwapBrowsersAndCloseOther(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargets(data.our);
		if (!our.window || !our.browser)
			return aEvent.preventDefault();

		var remote = this.getTabOpetarionTargets(data.remote);
		if (!remote.window || !remote.browser || !remote.tab)
			return aEvent.preventDefault();

		if (entry == data.our.entry)
			this.manager.fakeRedo('TabbarOperations', remote.window, data.remote.entry);
		else
			this.manager.fakeRedo('TabbarOperations', our.window, data.our.entry);

		var willClose = remote.browser.mTabContainer.childNodes.length == 1;
		data.remote.width  = remote.window.outerWidth;
		data.remote.height = remote.window.outerHeight;
		data.remote.x      = remote.window.screenX;
		data.remote.y      = remote.window.screenY;

		if (our.tab) {
			this.makeTabBlank(our.tab);
		}
		else {
			our.tab = our.browser.addTab('about:blank');
			this.manager.setElementId(our.tab, data.our.tab);
		}
		our.tab.linkedBrowser.stop();
		our.tab.linkedBrowser.docShell;
		our.browser.swapBrowsersAndCloseOther(our.tab, remote.tab);

		data.our.selected = this.manager.getId(our.browser.selectedTab);
		if (!willClose)
			data.remote.selected = this.manager.getId(remote.browser.selectedTab);
	},
 
	importTabOnDrop : function UT_importTabOnDrop(aTask, aTabBrowser, aDraggedTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var remoteBrowser = this.getTabBrowserFromChild(aDraggedTab);
		var remoteWindow  = aDraggedTab.ownerDocument.defaultView;

		var data = {
				our : {
					browser : this.manager.getId(aTabBrowser),
					parent  : this.manager.getBindingParentId(aTabBrowser),
					window  : this.manager.getId(aTabBrowser.ownerDocument.defaultView),
					oldSelected : this.manager.getId(aTabBrowser.selectedTab)
				},
				remote : {
					browser : this.manager.getId(remoteBrowser),
					parent  : this.manager.getBindingParentId(remoteBrowser),
					window  : this.manager.getId(remoteWindow),
					oldSelected : this.manager.getId(remoteBrowser.selectedTab),
					willClose   : remoteBrowser.mTabContainer.childNodes.length == 1
				}
			};

		data.our.entry = {
			name  : 'undotab-onDrop-importTab-our',
			label : this.bundle.getString('undo_importTabOnDrop_our_label'),
			data  : data
		};
		data.remote.entry = {
			name  : 'undotab-onDrop-importTab-remote',
			label : this.bundle.getString('undo_importTabOnDrop_remote_label'),
			data  : data
		};

		this.manager.doOperation(
			function(aInfo) {
				// We have to do this operation as an undoable task in the remote window!
				aInfo.manager.doOperation(
					function(aInfo) {
						aTask.call(aTabBrowser);
						data.our.newSelected = aInfo.manager.getId(aTabBrowser.selectedTab);
						if (!data.remote.willClose)
							data.remote.newSelected = aInfo.manager.getId(remoteBrowser.selectedTab);
					},
					'TabbarOperations',
					aDraggedTab.ownerDocument.defaultView,
					data.remote.entry
				);
			},
			'TabbarOperations',
			window,
			data.our.entry
		);
	},
	onUndoImportTabOnDrop : function UT_onUndoImportTabOnDrop(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargets(data.our);
		if (our.browser) {
			let selected = this.manager.getTargetById(data.our.oldSelected, our.browser.mTabContainer);
			if (selected)
				our.browser.selectedTab = selected;
		}

		var remote = this.getTabOpetarionTargets(data.remote);
		if (remote.browser) {
			let selected = this.manager.getTargetById(data.remote.oldSelected, remote.browser.mTabContainer);
			if (selected)
				remote.browser.selectedTab = selected;
		}

		if (entry == data.our.entry)
			this.manager.fakeUndo('TabbarOperations', remote.window, data.remote.entry);
		else
			this.manager.fakeUndo('TabbarOperations', our.window, data.our.entry);
	},
	onRedoImportTabOnDrop : function UT_onRedoImportTabOnDrop(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargets(data.our);
		if (our.browser) {
			// We have to change focus with delay, because the tab is not imported yet.
			// (It will be imported by onRedoSwapBrowsersAndCloseOther().)
			our.window.setTimeout(function() {
				let selected = aEvent.manager.getTargetById(data.our.newSelected, our.browser.mTabContainer);
				if (selected)
					our.browser.selectedTab = selected;
			}, 100);
		}

		var remote = this.getTabOpetarionTargets(data.remote);
		if (remote.browser) {
			let selected = this.manager.getTargetById(data.remote.newSelected, remote.browser.mTabContainer);
			if (selected)
				remote.browser.selectedTab = selected;
		}

		if (entry == data.our.entry)
			this.manager.fakeRedo('TabbarOperations', remote.window, data.remote.entry);
		else
			this.manager.fakeRedo('TabbarOperations', our.window, data.our.entry);
	},
 
	openNewTabOnDrop : function UT_openNewTabOnDrop(aTask, aTabBrowser) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var position = -1;
		this.manager.doOperation(
			function(aInfo) {
				aTask.call(aTabBrowser);
			},
			'TabbarOperations',
			window,
			{
				name   : 'undotab-onDrop-addTab',
				label  : this.bundle.getString('undo_addTabOnDrop_label'),
				onUndo : null,
				onRedo : null
			}
		);
	},
 
	onTearOffTab : function UT_onTearOffTab(aTask, aTabBrowser, aSourceTab) 
	{
		if (!this.isUndoable)
			return aTask.call(aTabBrowser);

		var ourBrowser = this.getTabBrowserFromChild(aSourceTab);
		var ourWindow  = aSourceTab.ownerDocument.defaultView;

		var data = {
				our : {
					window  : this.manager.getId(ourWindow),
					parent  : this.manager.getBindingParentId(ourBrowser),
					browser : this.manager.getId(ourBrowser),
					tab     : this.manager.getId(aSourceTab),
					position   : aSourceTab._tPos,
					isSelected : aSourceTab.selected
				},
				remote : {
					window : null
				}
			};
		data.our.entry = {
			name  : 'undotab-tearOffTab-our',
			label : this.bundle.getString('undo_tearOffTab_label'),
			data  : data
		};
		data.remote.entry = {
			name  : 'undotab-tearOffTab-remote',
			label : this.bundle.getString('undo_tearOffTab_label'),
			data  : data
		};

		var remoteWindow;
		this.manager.doOperation(
			function(aInfo) {
				remoteWindow = aTask.call(aTabBrowser);
				if (!remoteWindow)
					return false;

				var continuation = aInfo.getContinuation();
				remoteWindow.addEventListener('load', function() {
					remoteWindow.removeEventListener('load', arguments.callee, false);
					data.remote.window = aInfo.manager.getWindowId(remoteWindow);
					remoteWindow.setTimeout(function() { // wait for tab swap
						aInfo.manager.addEntry(
							'TabbarOperations',
							remoteWindow,
							data.remote.entry
						);
						continuation();
					}, 10);
				}, false);
			},
			'TabbarOperations',
			ourWindow,
			data.our.entry
		);

		return remoteWindow;
	},
	onUndoTearOffTab : function UT_onUndoTearOffTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargets(data.our);
		if (!our.window || !our.browser)
			return aEvent.preventDefault();

		var remote = this.getTabOpetarionTargets(data.remote);
		if (!remote.window || remote.window.closed)
			return aEvent.preventDefault();

		data.width  = remote.window.outerWidth;
		data.height = remote.window.outerHeight;
		data.x      = remote.window.screenX;
		data.y      = remote.window.screenY;

		if (entry == data.our.entry)
			this.manager.fakeUndo('TabbarOperations', remote.window, data.remote.entry);
		else
			this.manager.fakeUndo('TabbarOperations', our.window, data.our.entry);

		// Tab was possibly restored by undoing of removeTab(),
		// so close it internally.
		if (our.tab)
			this.irrevocableRemoveTab(our.tab, our.browser);

		our.tab = this.importTabTo(remote.window.gBrowser.selectedTab, our.browser);
		data.our.tab = this.manager.setElementId(our.tab, data.our.tab);

		our.browser.moveTabTo(our.tab, data.our.position);
		data.our.position = our.tab._tPos;

		if (data.our.isSelected)
			our.browser.selectedTab = our.tab;
	},
	onRedoTearOffTab : function UT_onRedoTearOffTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargets(data.our);
		if (!our.window || !our.browser || !our.tab)
			return aEvent.preventDefault();

		var continuation = aEvent.getContinuation();
		var remoteWindow = our.browser.replaceTabWithWindow(our.tab);
		remoteWindow.addEventListener('load', function() {
			remoteWindow.removeEventListener('load', arguments.callee, false);
			data.remote.window = aEvent.manager.setWindowId(remoteWindow, data.remote.window);
			remoteWindow.setTimeout(function() {
				remoteWindow.resizeTo(data.width, data.height);
				remoteWindow.moveTo(data.x, data.y);
				continuation();
				// We have to register new entry with delay, because
				// the state of the manager is still "redoing" when
				// just after continuation() is called.
				remoteWindow.setTimeout(function() {
					aEvent.manager.addEntry('TabbarOperations', remoteWindow, data.remote.entry);
				}, 250);
			}, 10);
		}, false);
	},
 
	onUndoCloseTab : function UT_onUndoCloseTab(aTask, aThis, aArguments) 
	{
		if (!this.isUndoable)
			return aTask.call(aThis);

		var tab;
		this.manager.doOperation(
			function(aInfo) {
				tab = aTask.apply(aThis, aArguments);
				if (!tab) return false;
			},
			'TabbarOperations',
			window,
			{
				name  : 'undotab-undoCloseTab',
				label : this.bundle.getString('undo_undoCloseTab_label')
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
  
