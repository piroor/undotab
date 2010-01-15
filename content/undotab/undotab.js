var UndoTabService = { 
	
	PREFROOT : 'extensions.undotab@piro.sakura.ne.jp', 

	KEY_ID_PREFIX : 'undotab-shortcut-',
	HISTORY_NAME  : 'TabbarOperations',
 
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
 
	get undoButton() { 
		return document.getElementById('undotab-undo-button');
	},
 
	get redoButton() { 
		return document.getElementById('undotab-redo-button');
	},
 
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
 
	moveTabBefore : function UT_moveTabBefore(aTab, aNextTab) 
	{
		if (!aTab)
			return;
		if (!aNextTab)
			throw new Error('reference tab must be specified.');

		var b = this.getTabBrowserFromChild(aTab);
		if (b != this.getTabBrowserFromChild(aNextTab))
			throw new Error('tabs are in different owners.');

		var position = aNextTab._tPos - 1;
		if (position < aTab._tPos)
			position++;
		if (aTab._tPos != position)
			b.moveTabTo(aTab, position);
	},
 
	moveTabAfter : function UT_moveTabAfter(aTab, aPrevTab) 
	{
		if (!aTab)
			return;
		if (!aPrevTab)
			throw new Error('reference tab must be specified.');

		var b = this.getTabBrowserFromChild(aTab);
		if (b != this.getTabBrowserFromChild(aPrevTab))
			throw new Error('tabs are in different owners.');

		var position = aPrevTab._tPos + 1;
		if (position > aTab._tPos)
			position--;
		if (aTab._tPos != position)
			b.moveTabTo(aTab, position);
	},
 
	moveTabBetween : function UT_moveTabBetween(aPrev, aTab, aNext, aData)
	{
		if (aPrev) {
			this.moveTabAfter(aTab, aPrev);
			if (aData)
				aData.next = this.getNextTabId(aTab);
			return;
		}
		if (aNext) {
			this.moveTabBefore(aTab, aNext);
			if (aData)
				aData.prev = this.getPrevTabId(aTab);
			return;
		}
	},
 
	getPrevTabId : function UT_getPrevTabId(aTab)
	{
		return aTab.previousSibling && aTab.previousSibling.localName == 'tab' ?
					this.manager.getId(aTab.previousSibling) :
					null ;
	},
	getNextTabId : function UT_getNextTabId(aTab)
	{
		return aTab.nextSibling && aTab.nextSibling.localName == 'tab' ?
					this.manager.getId(aTab.nextSibling) :
					null ;
	},
 
	getTabState : function UT_getTabState(aTab) /* PUBLIC API */ 
	{
		return this.SessionStore.getTabState(aTab);
	},
 
	setTabState : function UT_setTabState(aTab, aState) /* PUBLIC API */ 
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
	
	addEntry : function UT_addEntry() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.addEntry.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
 
	doOperation : function UT_doOperation() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.doOperation.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
 
	getHistory : function UT_getHistory() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.getHistory.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
 
	undo : function UT_undo() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.undo.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
 
	redo : function UT_redo() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.redo.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
 
	goToIndex : function UT_goToIndex() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.goToIndex.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
 
	isUndoing : function UT_isUndoing() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.isUndoing.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
	isRedoing : function UT_isRedoing() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.isRedoing.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
	isUndoable : function UT_isUndoable() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.isUndoable.apply(this.manager, [this.HISTORY_NAME, window].concat(Array.slice(arguments)));
	},
 
	fakeUndo : function UT_fakeUndo() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.fakeUndo.apply(this.manager, [this.HISTORY_NAME].concat(Array.slice(arguments)));
	},
 
	fakeRedo : function UT_fakeRedo() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.fakeRedo.apply(this.manager, [this.HISTORY_NAME].concat(Array.slice(arguments)));
	},
 
	getWindowId : function UT_getWindowId() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.getWindowId.apply(this.manager, arguments);
	},
	setWindowId : function UT_setWindowId() /* PUBLIC API (inherited from operationHistory) */
	{
		return this.manager.setWindowId.apply(this.manager, arguments);
	},
	getWindowById : function UT_getWindowById() /* PUBLIC API (inherited from operationHistory) */
	{
		return this.manager.getWindowById.apply(this.manager, arguments);
	},
 
	getElementId : function UT_getElementId() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.getElementId.apply(this.manager, arguments);
	},
	setElementId : function UT_setElementId() /* PUBLIC API (inherited from operationHistory) */
	{
		return this.manager.setElementId.apply(this.manager, arguments);
	},
	getElementById : function UT_getElementById() /* PUBLIC API (inherited from operationHistory) */
	{
		return this.manager.getElementById.apply(this.manager, arguments);
	},
 
	getId : function UT_getId() /* PUBLIC API (inherited from operationHistory) */ 
	{
		return this.manager.getId.apply(this.manager, arguments);
	},
	getTargetById : function UT_getTargetById() /* PUBLIC API (inherited from operationHistory) */
	{
		return this.manager.getTargetById.apply(this.manager, arguments);
	},
	getTargetsByIds : function UT_getTargetsByIds() /* PUBLIC API (inherited from operationHistory) */
	{
		return this.manager.getTargetsByIds.apply(this.manager, arguments);
	},
 
	getTabOpetarionTargetsData : function UT_getTabOpetarionTargetsData(aData, aExtra) /* PUBLIC API */ 
	{
		var ids = {
				window  : null,
				browser : null,
				tab     : null,
				tabs    : []
			};
		if (aData.window)
			ids.window = this.manager.getId(aData.window);
		if (aData.browser)
			ids.browser = this.manager.getId(aData.browser);
		if (aData.tab)
			ids.tab = this.manager.getId(aData.tab);
		if (aData.tabs) {
			if (aData.tabs.length &&
				'map' in aData.tabs &&
				typeof aData.tabs.map == 'function') {
				ids.tabs = aData.tabs.map(function(aTab) {
							return aTab ? this.manager.getId(aTab) : null ;
						}, this);
			}
			else {
				ids.tabs = {};
				for (let i in aData.tabs)
				{
					let tab = aData.tabs[i];
					if (
						!aData.tabs.hasOwnProperty(i) ||
						(!tab || tab.localName != 'tab')
						)
						continue;
					ids.tabs[i] = tab ? this.manager.getId(tab) : null ;
				}
			}
		}
		if (aExtra) {
			for (let i in aExtra)
			{
				if (aExtra.hasOwnProperty(i))
					ids[i] = aExtra[i];
			}
		}
		return ids;
	},
 
	getTabOpetarionTargetsBy : function UT_getTabOpetarionTargetsBy(aData) /* PUBLIC API */ 
	{
		var targets = {
				window  : null,
				browser : null,
				tab     : null,
				tabs    : []
			};
		if (!aData)
			return targets;

		targets.window = aData.window ?
				this.manager.getWindowById(aData.window) :
				window ;
		if (!targets.window)
			return targets;

		var manager = targets.window['piro.sakura.ne.jp'].operationHistory;

		targets.browser = aData.browser ?
				manager.getTargetById(aData.browser, targets.window) :
				null ;
		if (!targets.browser || (!aData.tab && !aData.tabs))
			return targets;

		if (aData.tab) {
			targets.tab = targets.browser ?
				manager.getTargetById(aData.tab, targets.browser.mTabContainer) :
				null ;
			if (targets.tab && !aData.tabs)
				targets.tabs.push(targets.tab);
		}
		if (aData.tabs) {
			if (aData.tabs.length &&
				'map' in aData.tabs &&
				typeof aData.tabs.map == 'function') {
				targets.tabs = manager.getTargetsByIds
								.apply(manager, [aData.tabs, targets.browser.mTabContainer])
								.filter(function(aTab) {
									return aTab;
								});
				if (targets.tabs.length)
					targets.tab = targets.tabs[0];
			}
			else {
				targets.tabs = {};
				for (let i in aData.tabs)
				{
					if (!aData.tabs.hasOwnProperty(i)) continue;
					targets.tabs[i] = aData.tabs[i] ?
							this.manager.getTargetById(aData.tabs[i], targets.browser.mTabContainer) :
							null ;
				}
			}
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
			let entries = history.entries;
			let max = entries.length-1;

			if (current == 0 && !history.canUndo)
				current--;
			else if (current == max && !history.canRedo)
				current++;

			entries = entries.map(function(aEntry) {
				return aEntry.label;
			});
			entries.unshift(this.bundle.getString('history_initial_label'));
			entries.push(this.bundle.getString('history_final_label'));
			entries.forEach(function(aLabel, aIndex) {
				let index = aIndex-1;
				let item = fragment.insertBefore(document.createElement('menuitem'), fragment.firstChild);
				item.setAttribute('label', aLabel);
				item.setAttribute('value', index <= current ? index-1 : index);
				item.setAttribute('type', 'radio');
				item.setAttribute('name', 'undotab-history-entry');
				if (index == current) {
					if (current >= 0 && current <= max) {
						let focused = fragment.insertBefore(document.createElement('menuitem'), fragment.firstChild);
						focused.setAttribute('label', this.bundle.getString('history_current_label'));
						focused.setAttribute('type', 'radio');
						focused.setAttribute('name', 'undotab-history-entry');
						focused.setAttribute('checked', true);
						focused.setAttribute('disabled', true);
						item.setAttribute('key', this.KEY_ID_PREFIX+'undo');
					}
					else {
						item.setAttribute('checked', true);
						item.setAttribute('disabled', true);
						if (item.previousSibling)
							item.previousSibling.setAttribute('key', this.KEY_ID_PREFIX+'undo');
					}
				}
				else if (index == current+1) {
					item.setAttribute('key', this.KEY_ID_PREFIX+'redo');
				}
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
 
	updateButtons : function UT_updateButtons(aCustomize) 
	{
		var undo = this.undoButton;
		var redo = this.redoButton;
		if (!undo && !redo) return;

		var history = this.getHistory();
		var current = history.currentEntry;
		if (undo) {
			if (history.canUndo && !aCustomize) {
				undo.setAttribute('tooltiptext',
					undo.getAttribute('tooltiptext-modifier')
						.replace(/%S/gi, current.label));
				undo.removeAttribute('disabled');
			}
			else {
				undo.setAttribute('tooltiptext',
					undo.getAttribute('tooltiptext-default'));
				undo.setAttribute('disabled', true);
			}
		}
		if (redo) {
			if (history.canRedo && !aCustomize) {
				redo.setAttribute('tooltiptext',
					redo.getAttribute('tooltiptext-modifier')
						.replace(/%S/gi, current.label));
				redo.removeAttribute('disabled');
			}
			else {
				redo.setAttribute('tooltiptext',
					redo.getAttribute('tooltiptext-default'));
				redo.setAttribute('disabled', true);
			}
		}
	},
  
/* Initializing */ 
	
	init : function UT_init() 
	{
		if (!('gBrowser' in window)) return;

		window.removeEventListener('DOMContentLoaded', this, false);

		window.addEventListener('unload', this, false);

		window.addEventListener('UIOperationHistoryPreUndo:TabbarOperations', this, false);
		window.addEventListener('UIOperationHistoryUndo:TabbarOperations', this, false);
		window.addEventListener('UIOperationHistoryRedo:TabbarOperations', this, false);
		window.addEventListener('UIOperationHistoryPostRedo:TabbarOperations', this, false);
		window.addEventListener('UIOperationHistoryUpdate:TabbarOperations', this, false);

		this.addPrefListener(this);
		window.setTimeout(function(aSelf) {
			aSelf.observe(null, 'nsPref:changed', aSelf.PREFROOT+'.undo.shortcut');
			aSelf.observe(null, 'nsPref:changed', aSelf.PREFROOT+'.redo.shortcut');
		}, 0, this);

		this.overrideGlobalFunctions();
		this.initTabBrowser(document.getElementById('content'));

		this.updateButtons();
	},
	
	overrideGlobalFunctions : function UT_overrideGlobalFunctions() 
	{
		eval('window.undoCloseTab = '+window.undoCloseTab.toSource().replace(
			/(\(([^\(\)]*)\)\s*\{)/,
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

		if ('BrowserCustomizeToolbar' in window) {
			eval('window.BrowserCustomizeToolbar = '+
				window.BrowserCustomizeToolbar.toSource().replace(
					'{',
					'{ UndoTabService.updateButtons(true); '
				)
			);
		}
		var toolbox = document.getElementById('navigator-toolbox');
		if (toolbox.customizeDone) {
			toolbox.__undotab__customizeDone = toolbox.customizeDone;
			toolbox.customizeDone = function(aChanged) {
				this.__undotab__customizeDone(aChanged);
				UndoTabService.updateButtons();
			};
		}
		if ('BrowserToolboxCustomizeDone' in window) {
			window.__undotab__BrowserToolboxCustomizeDone = window.BrowserToolboxCustomizeDone;
			window.BrowserToolboxCustomizeDone = function(aChanged) {
				window.__undotab__BrowserToolboxCustomizeDone.apply(window, arguments);
				UndoTabService.updateButtons();
			};
		}
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

		window.removeEventListener('UIOperationHistoryPreUndo:TabbarOperations', this, false);
		window.removeEventListener('UIOperationHistoryUndo:TabbarOperations', this, false);
		window.removeEventListener('UIOperationHistoryRedo:TabbarOperations', this, false);
		window.removeEventListener('UIOperationHistoryPostRedo:TabbarOperations', this, false);
		window.removeEventListener('UIOperationHistoryUpdate:TabbarOperations', this, false);

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

			case 'UIOperationHistoryPreUndo:TabbarOperations':
				switch(aEvent.entry.name)
				{
					case 'undotab-loadTabs':
						return this.onPreUndoLoadTabs(aEvent);
					case 'undotab-duplicateTab':
						return this.onPreUndoDuplicateTab(aEvent);
				}
				break;

			case 'UIOperationHistoryUndo:TabbarOperations':
				switch(aEvent.entry.name)
				{
					case 'undotab-addTab':
						return this.onUndoTabOpen(aEvent);
					case 'undotab-loadTabs':
						return this.onUndoLoadTabs(aEvent);
					case 'undotab-removeTab':
						return this.onUndoTabClose(aEvent);
					case 'undotab-moveTab':
						return this.onUndoTabMove(aEvent);
					case 'undotab-removeAllTabsBut':
						return this.onUndoRemoveAllTabsBut(aEvent);
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
					case 'undotab-addTab':
						return this.onRedoTabOpen(aEvent);
					case 'undotab-removeTab':
						return this.onRedoTabClose(aEvent);
					case 'undotab-moveTab':
						return this.onRedoTabMove(aEvent);
					case 'undotab-removeAllTabsBut':
						return this.onRedoRemoveAllTabsBut(aEvent);
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

			case 'UIOperationHistoryPostRedo:TabbarOperations':
				switch(aEvent.entry.name)
				{
					case 'undotab-loadTabs':
						return this.onPostRedoLoadTabs(aEvent);
					case 'undotab-duplicateTab':
						return this.onPostRedoDuplicateTab(aEvent);
				}
				break;

			case 'UIOperationHistoryUpdate:TabbarOperations':
				this.updateButtons();
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
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var entry;
		var self = this;
		this.manager.doOperation(
			function(aParams) {
				var before = self.getTabs(aTabBrowser).snapshotLength;
				aTask.call(aTabBrowser);
				var delta = before - self.getTabs(aTabBrowser).snapshotLength;
				if (delta > 1)
					entry.label = self.bundle.getFormattedString('undo_loadTabs_label', [delta]);
			},
			this.HISTORY_NAME,
			window,
			(entry = {
				name  : 'undotab-addTab',
				label : this.bundle.getString('undo_addTab_label'),
				data  : this.getTabOpetarionTargetsData({
					browser : aTabBrowser,
					tabs : { opened : aTab }
					}, {
					state      : this.getTabState(aTab),
					arguments  : aArguments
				})
			})
		);
	},
	onUndoTabOpen : function UT_onUndoTabOpen(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || !target.tabs.opened)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		data.state = this.getTabState(target.tabs.opened);
		data.prev = this.getPrevTabId(target.tabs.opened);
		data.next = this.getNextTabId(target.tabs.opened);
		data.isSelected = target.tabs.opened.selected;
		this.irrevocableRemoveTab(target.tabs.opened, target.browser);

		window.setTimeout(function() {
			window['piro.sakura.ne.jp'].stopRendering.start();
		}, 0);
	},
	onRedoTabOpen : function UT_onRedoTabOpen(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		var tab = target.browser.addTab.apply(target.browser, data.arguments);
		this.setTabState(tab, data.state);
		data.tabs.opened = this.manager.setElementId(tab, data.tabs.opened);

		this.moveTabBetween(target.tabs.prev, tab, target.tabs.next, data.tabs);
		if (data.isSelected)
			target.browser.selectedTab = tab;

		window.setTimeout(function() {
			window['piro.sakura.ne.jp'].stopRendering.start();
		}, 0);
	},
 
	onLoadTabs : function UT_onLoadTabs(aTask, aTabBrowser, aArguments) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var data = this.getTabOpetarionTargetsData({
				browser : aTabBrowser
				},{
				uris            : Array.slice(aArguments[0]),
				currentTabState : null,
				selected        : null,
				replace         : false
			});

		var self = this;
		this.manager.doOperation(
			function(aParams) {
				var beforeTabs = self.getTabsArray(aTabBrowser);
				aTask.call(aTabBrowser);
				var tabs = self.getTabsArray(aTabBrowser)
							.filter(function(aTab) {
								return beforeTabs.indexOf(aTab) < 0;
							});
				data.replace = (data.uris.length - tabs.length) == 1;
				if (data.replace) {
					data.currentTabState = self.getTabState(aTabBrowser.selectedTab);
					tabs.unshift(aTabBrowser.selectedTab);
				}
				data.tabs = tabs.map(function(aTab) {
					return self.manager.getId(aTab);
				});
			},
			this.HISTORY_NAME,
			window,
			{
				name  : 'undotab-loadTabs',
				label : this.bundle.getFormattedString('undo_loadTabs_label', [data.uris.length]),
				data  : data
			}
		);
	},
	onPreUndoLoadTabs : function UT_onPreUndoLoadTabs(aEvent)
	{
		var entry  = aEvent.entry;
		var data   = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (target.browser)
			data.selected = this.manager.getId(target.browser.selectedTab);
	},
	onUndoLoadTabs : function UT_onUndoLoadTabs(aEvent)
	{
		var entry  = aEvent.entry;
		var data   = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser)
			return aEvent.preventDefault();

		if (data.replace)
			this.setTabState(target.tab, data.currentTabState);
	},
	onPostRedoLoadTabs : function UT_onPostRedoLoadTabs(aEvent)
	{
		var entry  = aEvent.entry;
		var data   = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || target.tabs.length != data.tabs.length)
			return aEvent.preventDefault();

		if (data.replace)
			target.tabs[0].linkedBrowser.loadURI(data.uris[0], null, null);

		var selected = this.manager.getTargetById(data.selected, target.browser);
		if (selected)
			target.browser.selectedTab = selected;
	},
 
	onTabClose : function UT_onTabClose(aTask, aTabBrowser, aTab) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var entry;
		var self = this;
		this.manager.doOperation(
			function() {
				var before = self.getTabs(aTabBrowser).snapshotLength;
				aTask.call(aTabBrowser);
				var delta = before - self.getTabs(aTabBrowser).snapshotLength;
				if (delta > 1)
					entry.label = self.bundle.getFormattedString('undo_removeTabs_label', [delta]);
			},
			this.HISTORY_NAME,
			window,
			(entry = {
				name  : 'undotab-removeTab',
				label : this.bundle.getString('undo_removeTab_label'),
				data  : this.getTabOpetarionTargetsData({
					browser : aTabBrowser,
					tabs    : {
						closed : aTab,
						prev   : aTab.previousSibling,
						next   : aTab.nextSibling
					}
					}, {
						state : this.getTabState(aTab)
				})
			})
		);
	},
	onUndoTabClose : function UT_onUndoTabClose(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		var tab = target.browser.addTab('about:blank');
		this.setTabState(tab, data.state);
		data.tabs.closed = this.manager.setElementId(tab, data.tabs.closed);

		this.moveTabBetween(target.tabs.prev, tab, target.tabs.next, data.tabs);

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
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || !target.tabs.closed)
			return aEvent.preventDefault();

		window['piro.sakura.ne.jp'].stopRendering.stop();

		data.prev = this.getPrevTabId(target.tabs.closed);
		data.next = this.getNextTabId(target.tabs.closed);
		data.isSelected = target.tabs.closed.selected;
		data.state      = this.getTabState(target.tabs.closed);
		this.irrevocableRemoveTab(target.tabs.closed, target.browser);

		window.setTimeout(function() {
			window['piro.sakura.ne.jp'].stopRendering.start();
		}, 0);
	},
 
	onTabMove : function UT_onTabMove(aTask, aTabBrowser, aTab, aOldPosition) 
	{
		if (!this.isUndoable() || aTab._tPos == aOldPosition)
			return aTask.call(aTabBrowser);

		var allTabs = this.getTabsArray(aTabBrowser);
		allTabs.splice(aTab._tPos, 1);
		allTabs.splice(aOldPosition, 0, aTab);
		var data = this.getTabOpetarionTargetsData({
				browser : aTabBrowser,
				tabs    : {
					moved   : aTab,
					oldPrev : aOldPosition > 0 ? allTabs[aOldPosition-1] : null,
					oldNext : aOldPosition < allTabs.length-1 ? allTabs[aOldPosition+1] : null,
					newPrev : aTab.previousSibling,
					newNext : aTab.nextSibling
				}
			});

		var entry;
		var self = this;
		this.manager.doOperation(
			function() {
				var beforeTabs = self.getTabsArray(aTabBrowser);
				var beforePositions = beforeTabs.map(function(aTab) {
						return aTab._tPos;
					});
				aTask.call(aTabBrowser);
				var count = 0;
				beforeTabs.forEach(function(aTab, aIndex) {
					if (aTab.parentNode && aTab._tPos != beforePositions[aIndex])
						count++;
				});
				if (count > 1)
					entry.label = self.bundle.getFormattedString('undo_moveTabs_label', [count]);
			},
			this.HISTORY_NAME,
			window,
			(entry = {
				name  : 'undotab-moveTab',
				label : this.bundle.getString('undo_moveTab_label'),
				data  : data
			})
		);
	},
	onUndoTabMove : function UT_onUndoTabMove(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || !target.tabs.moved)
			return aEvent.preventDefault();

		var tab = target.tabs.moved;
		this.moveTabBetween(target.tabs.oldPrev, tab, target.tabs.oldNext);
		data.tabs.oldPrev = this.getPrevTabId(tab);
		data.tabs.oldNext = this.getNextTabId(tab);
	},
	onRedoTabMove : function UT_onRedoTabMove(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || !target.tabs.moved)
			return aEvent.preventDefault();

		var tab = target.tabs.moved;
		this.moveTabBetween(target.tabs.newPrev, tab, target.tabs.newNext);
		data.tabs.newPrev = this.getPrevTabId(tab);
		data.tabs.newNext = this.getNextTabId(tab);
	},
 
	onDuplicateTab : function UT_onDuplicateTab(aTask, aTabBrowser, aTab) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var b = this.getTabBrowserFromChild(aTab);
		var data = this.getTabOpetarionTargetsData({
				browser : aTabBrowser,
				tabs    : {}
				}, {
				isSelected : false
			});

		var newTab;

		var self = this;
		this.manager.doOperation(
			function(aParams) {
				newTab = aTask.call(aTabBrowser);
				if (!newTab)
					return false;

				data.tabs.duplicated = self.manager.getId(newTab);
				data.tabs.prev = self.getPrevTabId(newTab);
				data.tabs.next = self.getNextTabId(newTab);
				data.state = self.getTabState(aTab);
			},
			this.HISTORY_NAME,
			window,
			{
				name  : 'undotab-duplicateTab',
				label : this.bundle.getString('undo_duplicateTab_label'),
				data  : data
			}
		);
		return newTab;
	},
	onPreUndoDuplicateTab : function UT_onPreUndoDuplicateTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || !target.tabs.duplicated)
			return aEvent.preventDefault();

		data.isSelected = target.tabs.duplicated.selected;
	},
	onPostRedoDuplicateTab : function UT_onPostRedoDuplicateTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || !target.tabs.duplicated)
			return aEvent.preventDefault();

		var tab = target.tabs.duplicated;
		this.setTabState(tab, data.state);
		this.moveTabBetween(target.tabs.prev, tab, target.tabs.next, data.tabs);

		if (data.isSelected)
			target.browser.selectedTab = tab;
	},
 
	onRemoveAllTabsBut : function UT_onRemoveAllTabsBut(aTask, aTabBrowser, aLeftTab) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var count = this.getTabs(aTabBrowser).snapshotLength;
		var retVal;
		var self = this;
		this.manager.doOperation(
			function(aParams) {
				retVal = aTask.call(aTabBrowser);
				// don't register if the operation is canceled.
				return self.getTabs(aTabBrowser).snapshotLength != count;
			},
			this.HISTORY_NAME,
			window,
			{
				name  : 'undotab-removeAllTabsBut',
				label : this.bundle.getFormattedString('undo_removeAllTabsBut_label', [count-1]),
				data  : this.getTabOpetarionTargetsData({
					browser : aTabBrowser,
					tabs    : {
						prev : aLeftTab.previousSibling,
						left : aLeftTab,
						next : aLeftTab.nextSibling
					}
				})
			}
		);
		return retVal;
	},
	onUndoRemoveAllTabsBut : function UT_onUndoRemoveAllTabsBut(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser || !target.tabs.left)
			return aEvent.preventDefault();

		target.browser.selectedTab = target.tabs.left;
		this.moveTabBetween(target.tabs.prev, target.tabs.left, target.tabs.next, data.tabs);
	},
	onRedoRemoveAllTabsBut : function UT_onRedoRemoveAllTabsBut(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var target = this.getTabOpetarionTargetsBy(data);
		if (!target.browser)
			return aEvent.preventDefault();

		data.tabs.left = this.manager.getId(target.browser.selectedTab);
		data.tabs.prev = this.getPrevTabId(target.browser.selectedTab);
		data.tabs.next = this.getNextTabId(target.browser.selectedTab);
	},
 
	onSwapBrowsersAndCloseOther : function UT_onSwapBrowsersAndCloseOther(aTask, aTabBrowser, aArguments) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var ourTab     = aArguments[0];
		var ourBrowser = this.getTabBrowserFromChild(ourTab);
		var ourWindow  = ourTab.ownerDocument.defaultView;

		var remoteTab     = aArguments[1];
		var remoteBrowser = this.getTabBrowserFromChild(remoteTab);
		var remoteWindow  = remoteTab.ownerDocument.defaultView;

		var data = {
				our : this.getTabOpetarionTargetsData({
					window  : ourWindow,
					browser : ourBrowser,
					tabs    : {
						prev     : ourTab.previousSibling,
						imported : ourTab,
						next     : ourTab.nextSibling,
						selected : ourBrowser.selectedTab
					}
				}),
				remote : this.getTabOpetarionTargetsData({
					window  : remoteWindow,
					browser : remoteBrowser,
					tabs    : {
						prev     : remoteTab.previousSibling,
						exported : remoteTab,
						next     : remoteTab.nextSibling,
						selected : remoteBrowser.selectedTab
					}
					}, {
					width  : remoteWindow.outerWidth,
					height : remoteWindow.outerHeight,
					x      : remoteWindow.screenX,
					y      : remoteWindow.screenY
				})
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
				function(aParams) {
					retVal = aTask.call(aTabBrowser);
				},
				this.HISTORY_NAME,
				ourWindow,
				data.our.entry
			);
		}
		else {
			var self = this;
			this.manager.doOperation(
				function(aParams) {
					// We have to do this operation as an undoable task in the remote window!
					self.manager.doOperation(
						function(aParams) {
							retVal = aTask.call(aTabBrowser);
						},
						self.HISTORY_NAME,
						remoteWindow,
						data.remote.entry
					);
				},
				this.HISTORY_NAME,
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
		var our = this.getTabOpetarionTargetsBy(data.our);
		if (!our.window || !our.browser || !our.tabs.imported)
			return aEvent.preventDefault();

		var remote = this.getTabOpetarionTargetsBy(data.remote);
		if (!remote.window || remote.window.closed) {
			// The remote window was closed automatically.
			// So, we have to reopen the window.
			aEvent.wait();

			let remoteWindow = our.window.openDialog(our.window.location.href, '_blank', 'chrome,all,dialog=no', 'about:blank');
			// Don't do swap on this time, because the our tab will be
			// closed by undo process of addTab().
			// let remoteWindow = our.browser.replaceTabWithWindow(our.tab);

			let self = this;
			remoteWindow.addEventListener('load', function() {
				remoteWindow.removeEventListener('load', arguments.callee, false);
				data.remote.window = aEvent.manager.setWindowId(remoteWindow, data.remote.window);
				remoteWindow.setTimeout(function() {
					var b = remoteWindow.gBrowser;
					aEvent.manager.setElementId(b, data.remote.browser);
					remoteWindow.resizeTo(data.remote.width, data.remote.height);
					remoteWindow.moveTo(data.remote.x, data.remote.y);

					our.window['piro.sakura.ne.jp'].stopRendering.stop();
					remoteWindow['piro.sakura.ne.jp'].stopRendering.stop();

					// OK, let's swap them!
					data.our.tabs.prev = self.getPrevTabId(our.tabs.imported);
					data.our.tabs.next = self.getNextTabId(our.tabs.imported);
					remote.tabs.exported = self.importTabTo(our.tabs.imported, b);
					aEvent.manager.setElementId(remote.tabs.exported, data.remote.tabs.exported);

					var obsoleteTab = b.selectedTab;
					b.selectedTab = remote.tabs.exported;
					self.irrevocableRemoveTab(obsoleteTab, b);

					// reopen for undo of addTab()
					our.tabs.imported = our.browser.addTab('about:blank');
					self.manager.setElementId(our.tabs.imported, data.our.tabs.imported);
					self.moveTabBetween(our.tabs.prev, our.tabs.imported, our.tabs.next, data.our.tabs);

					our.window['piro.sakura.ne.jp'].stopRendering.start();
					remoteWindow['piro.sakura.ne.jp'].stopRendering.start();

					aEvent.continue();
					// We have to register new entry with delay, because
					// the state of the manager is still "undoing" when
					// just after aEvent.continue() is called.
					remoteWindow.setTimeout(function() {
						aEvent.manager.addEntry(self.HISTORY_NAME, remoteWindow, data.remote.entry);
						aEvent.manager.fakeUndo(self.HISTORY_NAME, remoteWindow, data.remote.entry);
					}, 250);
				}, 10);
			}, false);
			return;
		}

		if (entry == data.our.entry)
			this.manager.fakeUndo(this.HISTORY_NAME, remote.window, data.remote.entry);
		else
			this.manager.fakeUndo(this.HISTORY_NAME, our.window, data.our.entry);

		if (our.tabs.selected)
			our.browser.selectedTab = our.tabs.selected;

		if (remote.tabs.exported) {
			this.makeTabBlank(remote.tabs.exported);
		}
		else {
			remote.tabs.exported = remote.browser.addTab('about:blank');
			this.manager.setElementId(remote.tabs.exported, data.remote.tabs.exported);
		}
		remote.tabs.exported.linkedBrowser.stop();
		remote.tabs.exported.linkedBrowser.docShell;
		data.our.tabs.prev = this.getPrevTabId(our.tabs.imported);
		data.our.tabs.next = this.getNextTabId(our.tabs.imported);
		remote.browser.swapBrowsersAndCloseOther(remote.tabs.exported, our.tabs.imported);

		if (entry.name == 'undotab-swapBrowsersAndCloseOther-our') {
			this.moveTabBetween(remote.tabs.prev, remote.tabs.exported, remote.tabs.next, data.remote.tabs);
			// reopen for undo of addTab()
			our.tabs.imported = our.browser.addTab('about:blank');
			this.manager.setElementId(our.tabs.imported, data.our.tabs.imported);
			this.moveTabBetween(our.tabs.prev, our.tabs.imported, our.tabs.next, data.our.tabs);
		}

		// get from id again, because it is possibly the "exported" tab.
		var selected = this.manager.getTargetById(data.remote.tabs.selected, remote.browser.mTabContainer)
		if (selected)
			remote.browser.selectedTab = selected;
	},
	onRedoSwapBrowsersAndCloseOther : function UT_onRedoSwapBrowsersAndCloseOther(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var our = this.getTabOpetarionTargetsBy(data.our);
		if (!our.window || !our.browser)
			return aEvent.preventDefault();

		var remote = this.getTabOpetarionTargetsBy(data.remote);
		if (!remote.window || !remote.browser || !remote.tabs.exported)
			return aEvent.preventDefault();

		if (entry == data.our.entry)
			this.manager.fakeRedo(this.HISTORY_NAME, remote.window, data.remote.entry);
		else
			this.manager.fakeRedo(this.HISTORY_NAME, our.window, data.our.entry);

		var willClose = remote.browser.mTabContainer.childNodes.length == 1;
		data.remote.width  = remote.window.outerWidth;
		data.remote.height = remote.window.outerHeight;
		data.remote.x      = remote.window.screenX;
		data.remote.y      = remote.window.screenY;

		if (our.tabs.imported) {
			this.makeTabBlank(our.tabs.imported);
		}
		else {
			our.tabs.imported = our.browser.addTab('about:blank');
			this.manager.setElementId(our.tabs.imported, data.our.tabs.imported);
		}
		our.tabs.imported.linkedBrowser.stop();
		our.tabs.imported.linkedBrowser.docShell;
		our.browser.swapBrowsersAndCloseOther(our.tabs.imported, remote.tabs.exported);
		if (entry.name == 'undotab-swapBrowsersAndCloseOther-remote') {
			this.moveTabBetween(our.tabs.prev, our.tabs.imported, our.tabs.next, data.our.tabs);
		}

		data.our.tabs.selected = this.manager.getId(our.browser.selectedTab);
		if (!willClose && !remote.window.closed) {
			if (entry.name == 'undotab-swapBrowsersAndCloseOther-remote') {
				// reopen for redo of removeTab()
				remote.tabs.exported = remote.browser.addTab('about:blank');
				this.manager.setElementId(remote.tabs.exported, data.remote.tabs.exported);
				this.moveTabBetween(remote.tabs.prev, remote.tabs.exported, remote.tabs.next, data.remote.tabs);
			}
			data.remote.tabs.selected = this.manager.getId(remote.browser.selectedTab);
		}
	},
 
	importTabOnDrop : function UT_importTabOnDrop(aTask, aTabBrowser, aDraggedTab) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var remoteBrowser = this.getTabBrowserFromChild(aDraggedTab);
		var remoteWindow  = aDraggedTab.ownerDocument.defaultView;

		var data = {
				our : this.getTabOpetarionTargetsData({
					browser : aTabBrowser,
					window  : aTabBrowser.ownerDocument.defaultView,
					tabs    : {
						oldSelected : aTabBrowser.selectedTab
					}
				}),
				remote : this.getTabOpetarionTargetsData({
					browser : remoteBrowser,
					window  : remoteWindow,
					tabs    : {
						oldSelected : remoteBrowser.selectedTab
					}
					}, {
					willClose : remoteBrowser.mTabContainer.childNodes.length == 1
				})
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

		var self = this;
		this.manager.doOperation(
			function(aParams) {
				// We have to do this operation as an undoable task in the remote window!
				aParams.manager.doOperation(
					function(aParams) {
						aTask.call(aTabBrowser);
						data.our.tabs.newSelected = self.manager.getId(aTabBrowser.selectedTab);
						if (!data.remote.willClose && !remoteWindow.closed)
							data.remote.tabs.newSelected = self.manager.getId(remoteBrowser.selectedTab);
					},
					self.HISTORY_NAME,
					aDraggedTab.ownerDocument.defaultView,
					data.remote.entry
				);
			},
			this.HISTORY_NAME,
			window,
			data.our.entry
		);
	},
	onUndoImportTabOnDrop : function UT_onUndoImportTabOnDrop(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargetsBy(data.our);
		if (our.tabs.oldSelected)
			our.browser.selectedTab = our.tabs.oldSelected;

		var remote = this.getTabOpetarionTargetsBy(data.remote);
		if (remote.tabs.oldSelected)
			remote.browser.selectedTab = remote.tabs.oldSelected;

		if (entry == data.our.entry)
			this.manager.fakeUndo(this.HISTORY_NAME, remote.window, data.remote.entry);
		else
			this.manager.fakeUndo(this.HISTORY_NAME, our.window, data.our.entry);
	},
	onRedoImportTabOnDrop : function UT_onRedoImportTabOnDrop(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;

		var our = this.getTabOpetarionTargetsBy(data.our);
		if (our.browser) {
			// We have to change focus with delay, because the tab is not imported yet.
			// (It will be imported by onRedoSwapBrowsersAndCloseOther().)
			our.window.setTimeout(function() {
				let selected = aEvent.manager.getTargetById(data.our.tabs.newSelected, our.browser.mTabContainer);
				if (selected)
					our.browser.selectedTab = selected;
			}, 100);
		}

		var remote = this.getTabOpetarionTargetsBy(data.remote);
		if (remote.tabs.newSelected)
			remote.browser.selectedTab = remote.tabs.newSelected;

		if (entry == data.our.entry)
			this.manager.fakeRedo(this.HISTORY_NAME, remote.window, data.remote.entry);
		else
			this.manager.fakeRedo(this.HISTORY_NAME, our.window, data.our.entry);
	},
 
	openNewTabOnDrop : function UT_openNewTabOnDrop(aTask, aTabBrowser) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var position = -1;
		this.manager.doOperation(
			function(aParams) {
				aTask.call(aTabBrowser);
			},
			this.HISTORY_NAME,
			window,
			{
				name   : 'undotab-onDrop-addTab',
				label  : this.bundle.getString('undo_addTabOnDrop_label')
			}
		);
	},
 
	onTearOffTab : function UT_onTearOffTab(aTask, aTabBrowser, aSourceTab) 
	{
		if (!this.isUndoable())
			return aTask.call(aTabBrowser);

		var ourBrowser = this.getTabBrowserFromChild(aSourceTab);
		var ourWindow  = aSourceTab.ownerDocument.defaultView;

		var data = {
				our : this.getTabOpetarionTargetsData({
					window  : ourWindow,
					browser : ourBrowser,
					tabs    : {
						prev   : aSourceTab.previousSibling,
						source : aSourceTab,
						next   : aSourceTab.nextSibling
					}
					}, {
					isSelected : aSourceTab.selected
				}),
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
		var self = this;
		this.manager.doOperation(
			function(aParams) {
				remoteWindow = aTask.call(aTabBrowser);
				if (!remoteWindow)
					return false;

				aParams.wait();
				remoteWindow.addEventListener('load', function() {
					remoteWindow.removeEventListener('load', arguments.callee, false);
					var b = remoteWindow.gBrowser;
					data.remote.tab = self.manager.getId(b.selectedTab);
					data.remote.browser = self.manager.getId(b);
					data.remote.window = self.manager.getWindowId(remoteWindow);
					remoteWindow.setTimeout(function() { // wait for tab swap
						self.manager.addEntry(
							self.HISTORY_NAME,
							remoteWindow,
							data.remote.entry
						);
						aParams.continue();
					}, 10);
				}, false);
			},
			this.HISTORY_NAME,
			ourWindow,
			data.our.entry
		);
		return remoteWindow;
	},
	onUndoTearOffTab : function UT_onUndoTearOffTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		if (entry.name == 'undotab-tearOffTab-our')
			return;

		var our = this.getTabOpetarionTargetsBy(data.our);
		if (!our.window || !our.browser)
			return aEvent.preventDefault();

		var remote = this.getTabOpetarionTargetsBy(data.remote);
		if (!remote.window || remote.window.closed)
			return aEvent.preventDefault();

		data.width  = remote.window.outerWidth;
		data.height = remote.window.outerHeight;
		data.x      = remote.window.screenX;
		data.y      = remote.window.screenY;

		if (entry == data.our.entry)
			this.manager.fakeUndo(this.HISTORY_NAME, remote.window, data.remote.entry);
		else
			this.manager.fakeUndo(this.HISTORY_NAME, our.window, data.our.entry);

		// Tab was possibly restored by undoing of removeTab(),
		// so close it internally.
		if (our.tabs.source)
			this.irrevocableRemoveTab(our.tabs.source, our.browser);

		var finish = function() {
				var ourService = our.window.UndoTabService;
				our.tabs.source = ourService.importTabTo(remote.window.gBrowser.selectedTab, our.browser);
				data.our.tabs.source = ourService.manager.setElementId(our.tabs.source, data.our.tabs.source);
				ourService.moveTabBetween(our.tabs.prev, our.tabs.source, our.tabs.next, data.our.tabs);

				if (data.our.isSelected)
					our.browser.selectedTab = our.tabs.source;
			};

		if (entry == data.our.entry) {
			// this window is possibly closed, so run finishing processes in the remote window.
			aEvent.wait();
			our.window.setTimeout(function() {
				finish();
				aEvent.continue();
			}, 0);
		}
		else {
			finish();
		}
	},
	onRedoTearOffTab : function UT_onRedoTearOffTab(aEvent)
	{
		var entry = aEvent.entry;
		var data  = entry.data;
		var our = this.getTabOpetarionTargetsBy(data.our);
		if (!our.window || !our.browser || !our.tabs.source)
			return aEvent.preventDefault();

		aEvent.wait();
		var remoteWindow = our.window.openDialog(our.window.location.href, '_blank', 'chrome,all,dialog=no', 'about:blank');
		// Don't do swap on this time, because it will be re-done by
		// redo process of swapBrowsersAndCloseOther()
		// var remoteWindow = our.browser.replaceTabWithWindow(our.tabs.source);
		var self = this;
		remoteWindow.addEventListener('load', function() {
			remoteWindow.removeEventListener('load', arguments.callee, false);
			data.remote.window = aEvent.manager.setWindowId(remoteWindow, data.remote.window);
			remoteWindow.setTimeout(function() {
				remoteWindow.resizeTo(data.width, data.height);
				remoteWindow.moveTo(data.x, data.y);
				var b = remoteWindow.gBrowser;
				aEvent.manager.setElementId(b.selectedTab, data.remote.tab);
				aEvent.manager.setElementId(b, data.remote.browser);
				b.contentWindow.focus();
				aEvent.continue();
				// We have to register new entry with delay, because
				// the state of the manager is still "redoing" when
				// just after aEvent.continue() is called.
				remoteWindow.setTimeout(function() {
					aEvent.manager.addEntry(self.HISTORY_NAME, remoteWindow, data.remote.entry);
				}, 250);
			}, 10);
		}, false);
	},
 
	onUndoCloseTab : function UT_onUndoCloseTab(aTask, aThis, aArguments) 
	{
		if (!this.isUndoable())
			return aTask.call(aThis);

		var tab;
		this.manager.doOperation(
			function(aParams) {
				tab = aTask.apply(aThis, aArguments);
				if (!tab) return false;
			},
			this.HISTORY_NAME,
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
  
