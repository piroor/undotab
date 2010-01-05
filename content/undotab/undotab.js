var UndoTabOpsService = { 
	PREFROOT : 'extensions.undotab@piro.sakura.ne.jp',
	
	NSResolver : { 
		lookupNamespaceURI : function MTS_lookupNamespaceURI(aPrefix)
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
	evaluateXPath : function MTS_evaluateXPath(aExpression, aContext, aType)
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
				snapshotItem    : function MTS_snapshotItem() {
					return null
				}
			};
		}
		return xpathResult;
	},
 
/* Initializing */ 
	
	init : function MTS_init() 
	{
		if (!('gBrowser' in window)) return;

		window.addEventListener('mouseup', this, true);

		window.removeEventListener('load', this, false);
		window.addEventListener('unload', UndoTabOpsService, false);

		this.migratePrefs();
		this.addPrefListener(this);
		this.observe(null, 'nsPref:changed', 'extensions.multipletab.tabdrag.mode');
		this.observe(null, 'nsPref:changed', 'extensions.multipletab.tabclick.accel.mode');
		this.observe(null, 'nsPref:changed', 'extensions.multipletab.tabclick.shift.mode');
		this.observe(null, 'nsPref:changed', 'extensions.multipletab.selectionStyle');
		this.observe(null, 'nsPref:changed', 'extensions.multipletab.clipboard.linefeed');
		this.observe(null, 'nsPref:changed', 'extensions.multipletab.clipboard.formats');

/*
		if ('nsDragAndDrop' in window &&
			'startDrag' in nsDragAndDrop) {
			eval('nsDragAndDrop.startDrag = '+nsDragAndDrop.startDrag.toSource().replace(
				/(invokeDragSessionWithImage\([^\)]+,\s*)null\s*,\s*0,\s*0(\s*,[^\)]+\))/,
				'$1UndoTabOpsService.createDragFeedbackImage(aEvent.target), UndoTabOpsService.getDragFeedbackImageX(aEvent.target), UndoTabOpsService.getDragFeedbackImageY(aEvent.target)$2'
			));
		}
*/

		if ('internalSave' in window) {
			eval('window.internalSave = '+window.internalSave.toSource().replace(
				'var useSaveDocument =',
				<![CDATA[
					if (aChosenData && 'saveAsType' in aChosenData) {
						saveAsType = aChosenData.saveAsType;
						saveMode = SAVEMODE_FILEONLY | SAVEMODE_COMPLETE_TEXT;
					}
				$&]]>
			).replace(
				/(!aChosenData)( && useSaveDocument && saveAsType == kSaveAsType_Text)/,
				'($1 || "saveAsType" in aChosenData)$2'
			));
		}

		[
			'tm-freezeTab\tmultipletab-selection-freezeTabs',
			'tm-protectTab\tmultipletab-selection-protectTabs',
			'tm-lockTab\tmultipletab-selection-lockTabs'
		].forEach(function(aIDs) {
			aIDs = aIDs.split('\t');
			var source = document.getElementById(aIDs[0]);
			var target = document.getElementById(aIDs[1]);
			if (source)
				target.setAttribute('label', source.getAttribute('label'));
		}, this);

		this.initTabBrowser(gBrowser);

		this.overrideExtensionsOnInit(); // hacks.js

		window.setTimeout(function(aSelf) { aSelf.delayedInit(); }, 0, this);
	},
	
	initTabBrowser : function MTS_initTabBrowser(aTabBrowser) 
	{
		aTabBrowser.addEventListener('TabOpen', this, true);
		aTabBrowser.addEventListener('TabClose', this, true);
		aTabBrowser.addEventListener('TabMove', this, true);
		aTabBrowser.mTabContainer.addEventListener('draggesture', this, true);
		aTabBrowser.mTabContainer.addEventListener('mouseover',   this, true);
		aTabBrowser.mTabContainer.addEventListener('mousemove',   this, true);
		aTabBrowser.mTabContainer.addEventListener('mousedown',   this, true);

		if ('_onDrop' in aTabBrowser && 'swapBrowsersAndCloseOther' in aTabBrowser) {
			eval('aTabBrowser._onDrop = '+aTabBrowser._onDrop.toSource().replace(
				/(this\.swapBrowsersAndCloseOther\([^;]+\);)/,
				'UndoTabOpsService.fireWindowMoveEvent(newTab, draggedTab); $1'
			));
			aTabBrowser.__multipletab__canDoWindowMove = true;
		}
		else {
			if ('onDrop' in aTabBrowser) {
				eval('aTabBrowser.onDrop = '+aTabBrowser.onDrop.toSource().replace(
					/(this\.duplicateTab\([^\)]+)(\))/g,
					'$1, aEvent$2'
				));
			}
			aTabBrowser.__multipletab__canDoWindowMove = false;
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
 
	initTab : function MTS_initTab(aTab) 
	{
	},
  
	destroy : function MTS_destroy() 
	{
		this.destroyTabBrowser(gBrowser);
		window.addEventListener('mouseup', this, true);

		window.removeEventListener('unload', this, false);

		this.removePrefListener(this);

		this.getTabsArray(gBrowser).forEach(function(aTab) {
			this.destroyTab(aTab);
		}, this);

		var tabContextMenu = document.getAnonymousElementByAttribute(gBrowser, 'anonid', 'tabContextMenu');
		tabContextMenu.removeEventListener('popupshowing', this, false);
	},
	
	destroyTabBrowser : function MTS_destroyTabBrowser(aTabBrowser) 
	{
		aTabBrowser.removeEventListener('TabOpen', this, true);
		aTabBrowser.removeEventListener('TabClose', this, true);
		aTabBrowser.removeEventListener('TabMove', this, true);
		aTabBrowser.mTabContainer.removeEventListener('draggesture', this, true);
		aTabBrowser.mTabContainer.removeEventListener('mouseover',   this, true);
		aTabBrowser.mTabContainer.removeEventListener('mousemove',   this, true);
		aTabBrowser.mTabContainer.removeEventListener('mousedown',   this, true);
	},
 
	destroyTab : function MTS_destroyTab(aTab) 
	{
	},
   
/* Event Handling */ 
	
	handleEvent : function MTS_handleEvent(aEvent) 
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
  
/* Pref Listener */ 
	
	domain : 'extensions.undotab', 
 
	observe : function MTS_observe(aSubject, aTopic, aPrefName) 
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
  
