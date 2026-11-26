import{n as s,t as r}from"./chunk-BynQ4ihV.js";import{Jt as Zo,Xn as po,h as C,mr as uo,vt as Ri}from"./chunk-DH053RkN.js";import{A as S,et as nt}from"./chunk-DSGdOKrv.js";import{Bn as np,Bt as _g,Dr as zI,E as Hf,Et as XI,Gn as pE,Jt as cc,M as Jc,Mr as zy,Or as z_,Qt as dE,Sn as it,St as W_,U as M,Xt as cp,Yn as pv,_n as hp,an as ep,ar as sD,c as BI,cn as fE,d as Cl,dn as fo,dt as Se,en as dp,f as D,fn as fp,g as Ep,gn as he,i as $y,it as Q_,j as JE,kn as lE,m as Dl,mr as tp,mt as UI,nr as rD,or as sE,pr as te,qn as pc,qt as cE,vt as VE,w as Gy,wr as xr,xt as WI}from"./chunk-B_R8RfLq.js";import{t as B}from"./chunk-BOfq4VW4.js";import{i as ve$1,n as be}from"./chunk-B07Vo6MY.js";import{b as kt,t as B$1}from"./chunk-BxuziYWL.js";import{n as h}from"./chunk-ChHTRBQJ.js";import{d as Qr}from"./chunk-DkZu6Dna.js";import{a as Ee,g as oe,l as V,m as k}from"./chunk-BGzwaJVk.js";import{A as je,E as _i,p as tt,x as Es,y as Cs}from"./main-BY3TMLGQ.js";import{n as wt,t as Mt}from"./chunk-89PC7IrC.js";import{a as Q,l as wt$1,r as Et,u as z}from"./chunk-CUpMLDIP.js";import{t as n}from"./chunk-BCTo5pLv.js";import{Ht as sr,M as Pa,S as Kt,lt as co,q as Ya,x as Ka}from"./chunk-BUCf5JhG.js";import{Ht as ut,M as Lc,O as Ip,Q as Ta,R as Na,W as Ot,X as Rt,a as At,y as Fe}from"./chunk-C4KEbqsV.js";function Jt(n,e){n&1&&(xr(0,`p`,5),VE(1),rD(2,`translate`),cc(),xr(3,`p`,6),VE(4),rD(5,`translate`),cc()),n&2&&(pv(),pc(` `,sD(2,2,`WORKSPACE.GLOBAL_FAVORITES.NO_RESULTS`),` `),pv(3),pc(` `,sD(5,4,`WORKSPACE.GLOBAL_FAVORITES.NO_RESULTS_HINT`),` `))}function ti(n,e){n&1&&(xr(0,`p`,5),VE(1),rD(2,`translate`),cc(),xr(3,`p`,6),VE(4),rD(5,`translate`),cc()),n&2&&(pv(),pc(` `,sD(2,2,`WORKSPACE.GLOBAL_FAVORITES.EMPTY_TITLE`),` `),pv(3),pc(` `,sD(5,4,`WORKSPACE.GLOBAL_FAVORITES.EMPTY_HINT`),` `))}function ii(n,e){if(n&1&&(xr(0,`div`,1)(1,`mat-icon`,4),VE(2,`star_border`),cc(),BI(3,Jt,6,6)(4,ti,6,6),cc()),n&2){let t=sE();pv(3),UI(t.hasSearchTerm()?3:4)}}function ei(n,e){if(n&1){let t=XI();xr(0,`app-channel-list-item`,7),rD(1,`translate`),rD(2,`translate`),rD(3,`translate`),cp(`clicked`,function(){let a=Dl(t).$implicit,m=sE();return Cl(m.onChannelClick(a))})(`activated`,function(){let a=Dl(t).$implicit,m=sE();return Cl(m.onChannelActivate(a))})(`keyboardActivated`,function(){let a=Dl(t).$implicit,m=sE();return Cl(m.onPlaybackRequested(a))})(`favoriteToggled`,function(){let a=Dl(t).$implicit,m=sE();return Cl(m.onFavoriteToggled(a))})(`contextMenuRequested`,function(a){let m=Dl(t).$implicit,c=sE();return Cl(c.onChannelContextMenu(m,a))}),cc()}if(n&2){let t=e.$implicit,i=sE();tp(`isDraggable`,i.canDragDrop())(`logo`,t.logo)(`name`,t.name)(`disabled`,i.isUnavailable(t))(`statusLabel`,i.isUnavailable(t)?sD(1,16,t.catalogStatus===`missing`?`WORKSPACE.GLOBAL_FAVORITES.CATALOG_MISSING`:`WORKSPACE.GLOBAL_FAVORITES.CATALOG_UNKNOWN`):t.catalogDisabled?sD(2,18,`PORTALS.LIVE_TV`)+` — `+sD(3,20,`SETTINGS.STATUS_DISABLED`):``)(`selected`,i.activeUid()===t.uid)(`showEpg`,!i.isUnavailable(t)&&i.showEpg()&&t.radio!==`true`&&i.guideBySource[t.sourceType])(`isRadio`,t.radio===`true`)(`epgProgram`,t.currentEpgProgram)(`progressPercentage`,t.progressPercentage)(`catchupAvailable`,i.catchupAvailable(t))(`catchupDays`,i.catchupDays(t))(`showFavoriteButton`,!0)(`isFavorite`,i.isChannelFavorite(t))(`showProgramInfoButton`,!0)(`showDetailsContextMenu`,i.hasChannelContextMenu(t))}}var Yt=class n{constructor(){this.dialog=D(tt);this.epgBridge=D(h);this.runtime=D(B);this.epgPreferences=D(B$1);this.settingsStore=D(kt);this.channelContextMenu=Q_.required(Fe);this.openStreamOnDoubleClick=it(()=>this.settingsStore.openStreamOnDoubleClick());this.channels=z_.required();this.mode=z_(`favorites`);this.showEpg=z_(!0);this.favoriteUids=z_(/* @__PURE__ */ new Set);this.epgMap=z_(/* @__PURE__ */ new Map);this.progressTick=z_(0);this.activeUid=z_(null);this.searchTermInput=z_(``);this.draggable=z_(!0);this.sortMode=z_(Kt);this.channelSelected=W_();this.playbackRequested=W_();this.channelsReordered=W_();this.favoriteToggled=W_();this.removeRequested=W_();this.openInPlaylistRequested=W_();this.epgMappingChanged=W_();this.contextMenuChannel=Se(null);this.contextMenuUnavailable=it(()=>{let e=this.contextMenuChannel();return!!e&&Ri(e)});this.contextMenuCanOpenInPlaylist=it(()=>{let e=this.contextMenuChannel();return!!e&&this.canOpenInPlaylist(e)});this.contextMenuPlaylistName=it(()=>Zo(this.contextMenuChannel()?.playlistName));this.isCustomSort=it(()=>this.sortMode()===`custom`);this.canDragDrop=it(()=>this.mode()===`favorites`&&this.draggable()&&this.isCustomSort()&&!this.hasSearchTerm());this.hasSearchTerm=it(()=>this.searchTermInput().trim().length>0);this.enrichedChannels=it(()=>{let e=this.epgMap();return this.progressTick(),co(this.channels(),{searchTerm:this.searchTermInput(),sortMode:this.mode()===`favorites`?this.sortMode():null,getName:i=>i.name,getAddedAt:i=>i.addedAt}).map(i=>{let a=Ka(i),m=a?e.get(a)??null:null;return s(r({},i),{currentEpgProgram:m,progressPercentage:this.calcProgress(m)})})});this.isUnavailable=Ri}get supportsEpgMapping(){return this.epgPreferences.enabled()&&this.epgBridge.supportsEpgMapping}get guideBySource(){return{m3u:this.epgPreferences.enabled()&&this.runtime.supportsEpg,xtream:this.epgPreferences.enabled()&&this.runtime.supportsProviderEpg,stalker:this.epgPreferences.enabled()&&this.runtime.supportsProviderEpg}}catchupAvailable(e){return Ya({tv_archive:e.tvArchive,tv_archive_duration:e.tvArchiveDuration})}catchupDays(e){return sr({tv_archive_duration:e.tvArchiveDuration})}onPlaybackRequested(e){Ri(e)||this.playbackRequested.emit(e)}onChannelClick(e){Ri(e)||this.channelSelected.emit(e)}onChannelActivate(e){this.openStreamOnDoubleClick()&&!Ri(e)&&this.playbackRequested.emit(e)}onFavoriteToggled(e){this.favoriteToggled.emit(e)}onChannelContextMenu(e,t){this.contextMenuChannel.set(e),this.channelContextMenu().open(t)}hasChannelContextMenu(e){return Ri(e)?this.mode()===`recent`:!!e.m3uChannel||this.mode()===`recent`||this.canOpenInPlaylist(e)||this.supportsEpgMapping&&(e.xtreamId!=null||!!this.stalkerItemId(e))}canOpenInPlaylist(e){return Ri(e)?!1:Pa(e)!==null}openContextMenuChannelInPlaylist(){let e=this.contextMenuChannel();!e||!this.canOpenInPlaylist(e)||(this.channelContextMenu().close(),this.openInPlaylistRequested.emit(e))}openEpgMapping(){let e=this.contextMenuChannel();if(!e||Ri(e))return;this.channelContextMenu().close();let t=this.stalkerItemId(e),i=e.m3uChannel?Qr(e.m3uChannel):e.xtreamId!=null?uo(e.playlistId,e.xtreamId):t?po(e.playlistId,t):null;i&&this.openEpgMappingDialog(i,e)}async openEpgMappingDialog(e,t){let i=await this.epgBridge.getEpgMapping(e).catch(()=>null);ut.open(this.dialog,{channelKey:e,channelName:t.name,playlistId:t.m3uChannel?void 0:t.playlistId}).afterClosed().subscribe(async()=>{((await this.epgBridge.getEpgMapping(e).catch(()=>null))?.epgChannelId??null)!==(i?.epgChannelId??null)&&this.epgMappingChanged.emit()})}stalkerItemId(e){return e.sourceType!==`stalker`?null:e.uid.split(`::`)[2]?.trim()||null}openChannelDetails(){let e=this.contextMenuChannel(),t=e?.m3uChannel;!t||e&&Ri(e)||(this.channelContextMenu().close(),At.open(this.dialog,t))}removeContextMenuChannel(){let e=this.contextMenuChannel();e&&(this.channelContextMenu().close(),this.removeRequested.emit(e))}isChannelFavorite(e){return this.mode()===`favorites`||this.favoriteUids().has(e.uid)}onDrop(e){if(!this.canDragDrop())return;let t=[...this.channels()];Ta(t,e.previousIndex,e.currentIndex),this.channelsReordered.emit(t)}trackByUid(e,t){return t.uid}calcProgress(e){if(!e)return 0;let t=C(Date.now(),this.settingsStore.resolvedEpgOffsetMinutes()),i=new Date(e.start).getTime(),m=new Date(e.stop).getTime()-i,c=t-i;return Math.min(100,Math.max(0,c/m*100))}static{this.ɵfac=function(t){return new(t||n)}}static{this.ɵcmp=$y({type:n,selectors:[[`app-global-favorites-list`]],viewQuery:function(t,i){t&1&&hp(i.channelContextMenu,Fe,5),t&2&&pE()},inputs:{channels:[1,`channels`],mode:[1,`mode`],showEpg:[1,`showEpg`],favoriteUids:[1,`favoriteUids`],epgMap:[1,`epgMap`],progressTick:[1,`progressTick`],activeUid:[1,`activeUid`],searchTermInput:[1,`searchTermInput`],draggable:[1,`draggable`],sortMode:[1,`sortMode`]},outputs:{channelSelected:`channelSelected`,playbackRequested:`playbackRequested`,channelsReordered:`channelsReordered`,favoriteToggled:`favoriteToggled`,removeRequested:`removeRequested`,openInPlaylistRequested:`openInPlaylistRequested`,epgMappingChanged:`epgMappingChanged`},decls:6,vars:9,consts:[[`appChannelScrollFocus`,``,`cdkDropList`,``,1,`nav-list`,`app-scrollbar`,3,`cdkDropListDropped`,`cdkDropListDisabled`],[1,`empty-state`],[3,`isDraggable`,`logo`,`name`,`disabled`,`statusLabel`,`selected`,`showEpg`,`isRadio`,`epgProgram`,`progressPercentage`,`catchupAvailable`,`catchupDays`,`showFavoriteButton`,`isFavorite`,`showProgramInfoButton`,`showDetailsContextMenu`],[3,`mapEpg`,`details`,`openInPlaylist`,`removeFromHistory`,`showMapEpg`,`showDetails`,`openInPlaylistName`,`showRemoveFromHistory`],[1,`empty-icon`],[1,`empty-title`],[1,`empty-hint`],[3,`clicked`,`activated`,`keyboardActivated`,`favoriteToggled`,`contextMenuRequested`,`isDraggable`,`logo`,`name`,`disabled`,`statusLabel`,`selected`,`showEpg`,`isRadio`,`epgProgram`,`progressPercentage`,`catchupAvailable`,`catchupDays`,`showFavoriteButton`,`isFavorite`,`showProgramInfoButton`,`showDetailsContextMenu`]],template:function(t,i){t&1&&(xr(0,`div`,0),rD(1,`translate`),cp(`cdkDropListDropped`,function(m){return i.onDrop(m)}),BI(2,ii,5,1,`div`,1),WI(3,ei,4,22,`app-channel-list-item`,2,i.trackByUid,!0),cc(),xr(5,`app-channel-context-menu`,3),cp(`mapEpg`,function(){return i.openEpgMapping()})(`details`,function(){return i.openChannelDetails()})(`openInPlaylist`,function(){return i.openContextMenuChannelInPlaylist()})(`removeFromHistory`,function(){return i.removeContextMenuChannel()}),cc()),t&2&&(tp(`cdkDropListDisabled`,!i.canDragDrop()),ep(`aria-label`,sD(1,7,`HOME.PLAYLISTS.CHANNELS`)),pv(2),UI(i.enrichedChannels().length===0?2:-1),pv(),zI(i.enrichedChannels()),pv(2),tp(`showMapEpg`,i.supportsEpgMapping&&!i.contextMenuUnavailable())(`showDetails`,!!i.contextMenuChannel()?.m3uChannel&&!i.contextMenuUnavailable())(`openInPlaylistName`,i.contextMenuCanOpenInPlaylist()?i.contextMenuPlaylistName():null)(`showRemoveFromHistory`,i.mode()===`recent`))},dependencies:[Fe,Ot,Rt,Na,Ip,Mt,wt,be,ve$1],styles:[`[_nghost-%COMP%]{display:flex;flex-direction:column;height:100%;min-height:0;overflow:hidden}.search-panel[_ngcontent-%COMP%]{margin-top:10px;display:flex;justify-content:center;margin-bottom:-10px;flex-shrink:0}.search-bar[_ngcontent-%COMP%]{width:90%;--%NS%mat-form-field-container-height: 36px;--%NS%mat-form-field-filled-label-display: none;--%NS%mat-form-field-container-vertical-padding: 6px;--%NS%mat-form-field-filled-with-label-container-padding-top: 6px;--%NS%mat-form-field-filled-with-label-container-padding-bottom: 6px}[_nghost-%COMP%]     .search-bar div{border-radius:20px}[_nghost-%COMP%]     .search-bar div[matformfieldlineripple], [_nghost-%COMP%]     .search-bar .mat-mdc-form-field-subscript-wrapper{display:none}.nav-list[_ngcontent-%COMP%]{flex:1;overflow-y:auto;overflow-x:hidden;padding:8px 8px 12px;display:flex;flex-direction:column;gap:2px}.empty-state[_ngcontent-%COMP%]{display:flex;flex-direction:column;align-items:center;justify-content:center;padding:48px 24px;text-align:center;color:var(--%NS%mat-sys-on-surface-variant)}.empty-state[_ngcontent-%COMP%]   .empty-icon[_ngcontent-%COMP%]{font-size:48px;height:48px;width:48px;margin-bottom:16px;opacity:.5}.empty-state[_ngcontent-%COMP%]   .empty-title[_ngcontent-%COMP%]{font-size:14px;font-weight:500;margin:0 0 8px}.empty-state[_ngcontent-%COMP%]   .empty-hint[_ngcontent-%COMP%]{font-size:12px;opacity:.7;margin:0;max-width:260px}`]})}};var ni=new M(`ListOption`);var ai=(()=>{class n{_elementRef=D(fo);static ɵfac=function(i){return new(i||n)};static ɵdir=zy({type:n,selectors:[[``,`matListItemTitle`,``]],hostAttrs:[1,`mat-mdc-list-item-title`,`mdc-list-item__primary-text`]})}return n})();var mi=(()=>{class n{_elementRef=D(fo);static ɵfac=function(i){return new(i||n)};static ɵdir=zy({type:n,selectors:[[``,`matListItemLine`,``]],hostAttrs:[1,`mat-mdc-list-item-line`,`mdc-list-item__secondary-text`]})}return n})();var li=(()=>{class n{static ɵfac=function(i){return new(i||n)};static ɵdir=zy({type:n,selectors:[[``,`matListItemMeta`,``]],hostAttrs:[1,`mat-mdc-list-item-meta`,`mdc-list-item__end`]})}return n})();var $t=(()=>{class n{_listOption=D(ni,{optional:!0});_isAlignedAtStart(){return!this._listOption||this._listOption?._getTogglePosition()===`after`}static ɵfac=function(i){return new(i||n)};static ɵdir=zy({type:n,hostVars:4,hostBindings:function(i,a){i&2&&Ep(`mdc-list-item__start`,a._isAlignedAtStart())(`mdc-list-item__end`,!a._isAlignedAtStart())}})}return n})();var si=(()=>{class n extends $t{static ɵfac=(()=>{let t;return function(a){return(t||(t=_g(n)))(a||n)}})();static ɵdir=zy({type:n,selectors:[[``,`matListItemAvatar`,``]],hostAttrs:[1,`mat-mdc-list-item-avatar`],features:[Hf]})}return n})();var ci=(()=>{class n extends $t{static ɵfac=(()=>{let t;return function(a){return(t||(t=_g(n)))(a||n)}})();static ɵdir=zy({type:n,selectors:[[``,`matListItemIcon`,``]],hostAttrs:[1,`mat-mdc-list-item-icon`],features:[Hf]})}return n})();var ri=new M(`MAT_LIST_CONFIG`);var H=(()=>{class n{_isNonInteractive=!0;get disableRipple(){return this._disableRipple}set disableRipple(t){this._disableRipple=Cs(t)}_disableRipple=!1;get disabled(){return this._disabled()}set disabled(t){this._disabled.set(Cs(t))}_disabled=Se(!1);_defaultOptions=D(ri,{optional:!0});static ɵfac=function(i){return new(i||n)};static ɵdir=zy({type:n,hostVars:1,hostBindings:function(i,a){i&2&&ep(`aria-disabled`,a.disabled)},inputs:{disableRipple:`disableRipple`,disabled:`disabled`}})}return n})();var oi=(()=>{class n{_elementRef=D(fo);_ngZone=D(he);_listBase=D(H,{optional:!0});_platform=D(V);_hostElement;_isButtonElement;_noopAnimations=Es();_avatars;_icons;set lines(t){this._explicitLines=k(t,null),this._updateItemLines(!1)}_explicitLines=null;get disableRipple(){return this.disabled||this._disableRipple||this._noopAnimations||!!this._listBase?.disableRipple}set disableRipple(t){this._disableRipple=Cs(t)}_disableRipple=!1;get disabled(){return this._disabled()||!!this._listBase?.disabled}set disabled(t){this._disabled.set(Cs(t))}_disabled=Se(!1);_subscriptions=new S;_rippleRenderer=null;_hasUnscopedTextContent=!1;rippleConfig;get rippleDisabled(){return this.disableRipple||!!this.rippleConfig.disabled}constructor(){D(Ee).load(wt$1);let t=D(Q,{optional:!0});this.rippleConfig=t||{},this._hostElement=this._elementRef.nativeElement,this._isButtonElement=this._hostElement.nodeName.toLowerCase()===`button`,this._listBase&&!this._listBase._isNonInteractive&&this._initInteractiveListItem(),this._isButtonElement&&!this._hostElement.hasAttribute(`type`)&&this._hostElement.setAttribute(`type`,`button`)}ngAfterViewInit(){this._monitorProjectedLinesAndTitle(),this._updateItemLines(!0)}ngOnDestroy(){this._subscriptions.unsubscribe(),this._rippleRenderer!==null&&this._rippleRenderer._removeTriggerEvents()}_hasIconOrAvatar(){return!!(this._avatars.length||this._icons.length)}_initInteractiveListItem(){this._hostElement.classList.add(`mat-mdc-list-item-interactive`),this._rippleRenderer=new z(this,this._ngZone,this._hostElement,this._platform,D(te)),this._rippleRenderer.setupTriggerEvents(this._hostElement)}_monitorProjectedLinesAndTitle(){this._ngZone.runOutsideAngular(()=>{this._subscriptions.add(nt(this._lines.changes,this._titles.changes).subscribe(()=>this._updateItemLines(!1)))})}_updateItemLines(t){if(!this._lines||!this._titles||!this._unscopedContent)return;t&&this._checkDomForUnscopedTextContent();let i=this._explicitLines??this._inferLinesFromContent(),a=this._unscopedContent.nativeElement;if(this._hostElement.classList.toggle(`mat-mdc-list-item-single-line`,i<=1),this._hostElement.classList.toggle(`mdc-list-item--with-one-line`,i<=1),this._hostElement.classList.toggle(`mdc-list-item--with-two-lines`,i===2),this._hostElement.classList.toggle(`mdc-list-item--with-three-lines`,i===3),this._hasUnscopedTextContent){let m=this._titles.length===0&&i===1;a.classList.toggle(`mdc-list-item__primary-text`,m),a.classList.toggle(`mdc-list-item__secondary-text`,!m)}else a.classList.remove(`mdc-list-item__primary-text`),a.classList.remove(`mdc-list-item__secondary-text`)}_inferLinesFromContent(){let t=this._titles.length+this._lines.length;return this._hasUnscopedTextContent&&(t+=1),t}_checkDomForUnscopedTextContent(){this._hasUnscopedTextContent=Array.from(this._unscopedContent.nativeElement.childNodes).filter(t=>t.nodeType!==t.COMMENT_NODE).some(t=>!!(t.textContent&&t.textContent.trim()))}static ɵfac=function(i){return new(i||n)};static ɵdir=zy({type:n,contentQueries:function(i,a,m){if(i&1&&dp(m,si,4)(m,ci,4),i&2){let c;dE(c=fE())&&(a._avatars=c),dE(c=fE())&&(a._icons=c)}},hostVars:4,hostBindings:function(i,a){i&2&&(ep(`aria-disabled`,a.disabled)(`disabled`,a._isButtonElement&&a.disabled||null),Ep(`mdc-list-item--disabled`,a.disabled))},inputs:{lines:`lines`,disableRipple:`disableRipple`,disabled:`disabled`}})}return n})();var ve=(()=>{class n extends oi{_lines;_titles;_meta;_unscopedContent;_itemText;get activated(){return this._activated}set activated(t){this._activated=Cs(t)}_activated=!1;_getAriaCurrent(){return this._hostElement.nodeName===`A`&&this._activated?`page`:null}_hasBothLeadingAndTrailing(){return this._meta.length!==0&&(this._avatars.length!==0||this._icons.length!==0)}static ɵfac=(()=>{let t;return function(a){return(t||(t=_g(n)))(a||n)}})();static ɵcmp=(function(){let t=[`unscopedContent`],i=[`text`],a=[[[``,`matListItemAvatar`,``],[``,`matListItemIcon`,``]],[[``,`matListItemTitle`,``]],[[``,`matListItemLine`,``]],`*`,[[``,`matListItemMeta`,``]],[[`mat-divider`]]];return $y({type:n,selectors:[[`mat-list-item`],[`a`,`mat-list-item`,``],[`button`,`mat-list-item`,``]],contentQueries:function(g,s,_){if(g&1&&dp(_,mi,5)(_,ai,5)(_,li,5),g&2){let N;dE(N=fE())&&(s._lines=N),dE(N=fE())&&(s._titles=N),dE(N=fE())&&(s._meta=N)}},viewQuery:function(g,s){if(g&1&&fp(t,5)(i,5),g&2){let _;dE(_=fE())&&(s._unscopedContent=_.first),dE(_=fE())&&(s._itemText=_.first)}},hostAttrs:[1,`mat-mdc-list-item`,`mdc-list-item`],hostVars:13,hostBindings:function(g,s){g&2&&(ep(`aria-current`,s._getAriaCurrent()),Ep(`mdc-list-item--activated`,s.activated)(`mdc-list-item--with-leading-avatar`,s._avatars.length!==0)(`mdc-list-item--with-leading-icon`,s._icons.length!==0)(`mdc-list-item--with-trailing-meta`,s._meta.length!==0)(`mat-mdc-list-item-both-leading-and-trailing`,s._hasBothLeadingAndTrailing())(`_mat-animation-noopable`,s._noopAnimations))},inputs:{activated:`activated`},exportAs:[`matListItem`],features:[Hf],ngContentSelectors:[`[matListItemAvatar],[matListItemIcon]`,`[matListItemTitle]`,`[matListItemLine]`,`*`,`[matListItemMeta]`,`mat-divider`],decls:10,vars:0,consts:[[`unscopedContent`,``],[1,`mdc-list-item__content`],[1,`mat-mdc-list-item-unscoped-content`,3,`cdkObserveContent`],[1,`mat-focus-indicator`]],template:function(g,s){g&1&&(cE(a),lE(0),xr(1,`span`,1),lE(2,1),lE(3,2),xr(4,`span`,2,0),cp(`cdkObserveContent`,function(){return s._updateItemLines(!0)}),lE(6,3),cc()(),lE(7,4),lE(8,5),np(9,`div`,3))},dependencies:[_i],encapsulation:2})})()}return n})();var xe=(()=>{class n extends H{_isNonInteractive=!1;static ɵfac=(()=>{let t;return function(a){return(t||(t=_g(n)))(a||n)}})();static ɵcmp=(function(){return $y({type:n,selectors:[[`mat-nav-list`]],hostAttrs:[`role`,`navigation`,1,`mat-mdc-nav-list`,`mat-mdc-list-base`,`mdc-list`],exportAs:[`matNavList`],features:[JE([{provide:H,useExisting:n}]),Hf],ngContentSelectors:[`*`],decls:1,vars:0,template:function(a,m){a&1&&(cE(),lE(0))},styles:[`.mdc-list {
  margin: 0;
  padding: 8px 0;
  list-style-type: none;
}
.mdc-list:focus {
  outline: none;
}

.mdc-list-item {
  display: flex;
  position: relative;
  justify-content: flex-start;
  overflow: hidden;
  padding: 0;
  align-items: stretch;
  cursor: pointer;
  padding-left: 16px;
  padding-right: 16px;
  background-color: var(--%NS%mat-list-list-item-container-color, transparent);
  border-radius: var(--%NS%mat-list-list-item-container-shape, var(--%NS%mat-sys-corner-none));
}
.mdc-list-item.mdc-list-item--selected {
  background-color: var(--%NS%mat-list-list-item-selected-container-color);
}
.mdc-list-item:focus {
  outline: 0;
}
.mdc-list-item.mdc-list-item--disabled {
  cursor: auto;
}
.mdc-list-item.mdc-list-item--with-one-line {
  height: var(--%NS%mat-list-list-item-one-line-container-height, 48px);
}
.mdc-list-item.mdc-list-item--with-one-line .mdc-list-item__start {
  align-self: center;
  margin-top: 0;
}
.mdc-list-item.mdc-list-item--with-one-line .mdc-list-item__end {
  align-self: center;
  margin-top: 0;
}
.mdc-list-item.mdc-list-item--with-two-lines {
  height: var(--%NS%mat-list-list-item-two-line-container-height, 64px);
}
.mdc-list-item.mdc-list-item--with-two-lines .mdc-list-item__start {
  align-self: flex-start;
  margin-top: 16px;
}
.mdc-list-item.mdc-list-item--with-two-lines .mdc-list-item__end {
  align-self: center;
  margin-top: 0;
}
.mdc-list-item.mdc-list-item--with-three-lines {
  height: var(--%NS%mat-list-list-item-three-line-container-height, 88px);
}
.mdc-list-item.mdc-list-item--with-three-lines .mdc-list-item__start {
  align-self: flex-start;
  margin-top: 16px;
}
.mdc-list-item.mdc-list-item--with-three-lines .mdc-list-item__end {
  align-self: flex-start;
  margin-top: 16px;
}
.mdc-list-item.mdc-list-item--%NS%selected::before, .mdc-list-item.mdc-list-item--%NS%selected:focus::before, .mdc-list-item:not(.mdc-list-item--selected):focus::before {
  position: absolute;
  box-sizing: border-box;
  width: 100%;
  height: 100%;
  top: 0;
  left: 0;
  content: "";
  pointer-events: none;
}

a.mdc-list-item {
  color: inherit;
  text-decoration: none;
}

.mdc-list-item__start {
  fill: currentColor;
  flex-shrink: 0;
  pointer-events: none;
}
.mdc-list-item--with-leading-icon .mdc-list-item__start {
  color: var(--%NS%mat-list-list-item-leading-icon-color, var(--%NS%mat-sys-on-surface-variant));
  width: var(--%NS%mat-list-list-item-leading-icon-size, 24px);
  height: var(--%NS%mat-list-list-item-leading-icon-size, 24px);
  margin-left: 16px;
  margin-right: 32px;
}
[dir=rtl] .mdc-list-item--with-leading-icon .mdc-list-item__start {
  margin-left: 32px;
  margin-right: 16px;
}
.mdc-list-item--%NS%with-leading-icon:hover .mdc-list-item__start {
  color: var(--%NS%mat-list-list-item-hover-leading-icon-color);
}
.mdc-list-item--with-leading-avatar .mdc-list-item__start {
  width: var(--%NS%mat-list-list-item-leading-avatar-size, 40px);
  height: var(--%NS%mat-list-list-item-leading-avatar-size, 40px);
  margin-left: 16px;
  margin-right: 16px;
  border-radius: 50%;
}
.mdc-list-item--with-leading-avatar .mdc-list-item__start, [dir=rtl] .mdc-list-item--with-leading-avatar .mdc-list-item__start {
  margin-left: 16px;
  margin-right: 16px;
  border-radius: 50%;
}

.mdc-list-item__end {
  flex-shrink: 0;
  pointer-events: none;
}
.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  font-family: var(--%NS%mat-list-list-item-trailing-supporting-text-font, var(--%NS%mat-sys-label-small-font));
  line-height: var(--%NS%mat-list-list-item-trailing-supporting-text-line-height, var(--%NS%mat-sys-label-small-line-height));
  font-size: var(--%NS%mat-list-list-item-trailing-supporting-text-size, var(--%NS%mat-sys-label-small-size));
  font-weight: var(--%NS%mat-list-list-item-trailing-supporting-text-weight, var(--%NS%mat-sys-label-small-weight));
  letter-spacing: var(--%NS%mat-list-list-item-trailing-supporting-text-tracking, var(--%NS%mat-sys-label-small-tracking));
}
.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  color: var(--%NS%mat-list-list-item-trailing-icon-color, var(--%NS%mat-sys-on-surface-variant));
  width: var(--%NS%mat-list-list-item-trailing-icon-size, 24px);
  height: var(--%NS%mat-list-list-item-trailing-icon-size, 24px);
}
.mdc-list-item--%NS%with-trailing-icon:hover .mdc-list-item__end {
  color: var(--%NS%mat-list-list-item-hover-trailing-icon-color);
}
.mdc-list-item.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  color: var(--%NS%mat-list-list-item-trailing-supporting-text-color, var(--%NS%mat-sys-on-surface-variant));
}
.mdc-list-item--selected.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  color: var(--%NS%mat-list-list-item-selected-trailing-icon-color, var(--%NS%mat-sys-primary));
}

.mdc-list-item__content {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  align-self: center;
  flex: 1;
  pointer-events: none;
}
.mdc-list-item--with-two-lines .mdc-list-item__content, .mdc-list-item--with-three-lines .mdc-list-item__content {
  align-self: stretch;
}

.mdc-list-item__primary-text {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  color: var(--%NS%mat-list-list-item-label-text-color, var(--%NS%mat-sys-on-surface));
  font-family: var(--%NS%mat-list-list-item-label-text-font, var(--%NS%mat-sys-body-large-font));
  line-height: var(--%NS%mat-list-list-item-label-text-line-height, var(--%NS%mat-sys-body-large-line-height));
  font-size: var(--%NS%mat-list-list-item-label-text-size, var(--%NS%mat-sys-body-large-size));
  font-weight: var(--%NS%mat-list-list-item-label-text-weight, var(--%NS%mat-sys-body-large-weight));
  letter-spacing: var(--%NS%mat-list-list-item-label-text-tracking, var(--%NS%mat-sys-body-large-tracking));
}
.mdc-list-item:hover .mdc-list-item__primary-text {
  color: var(--%NS%mat-list-list-item-hover-label-text-color, var(--%NS%mat-sys-on-surface));
}
.mdc-list-item:focus .mdc-list-item__primary-text {
  color: var(--%NS%mat-list-list-item-focus-label-text-color, var(--%NS%mat-sys-on-surface));
}
.mdc-list-item--with-two-lines .mdc-list-item__primary-text, .mdc-list-item--with-three-lines .mdc-list-item__primary-text {
  display: block;
  margin-top: 0;
  line-height: normal;
  margin-bottom: -20px;
}
.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before, .mdc-list-item--with-three-lines .mdc-list-item__primary-text::before {
  display: inline-block;
  width: 0;
  height: 28px;
  content: "";
  vertical-align: 0;
}
.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after, .mdc-list-item--with-three-lines .mdc-list-item__primary-text::after {
  display: inline-block;
  width: 0;
  height: 20px;
  content: "";
  vertical-align: -20px;
}

.mdc-list-item__secondary-text {
  text-overflow: ellipsis;
  white-space: nowrap;
  overflow: hidden;
  display: block;
  margin-top: 0;
  color: var(--%NS%mat-list-list-item-supporting-text-color, var(--%NS%mat-sys-on-surface-variant));
  font-family: var(--%NS%mat-list-list-item-supporting-text-font, var(--%NS%mat-sys-body-medium-font));
  line-height: var(--%NS%mat-list-list-item-supporting-text-line-height, var(--%NS%mat-sys-body-medium-line-height));
  font-size: var(--%NS%mat-list-list-item-supporting-text-size, var(--%NS%mat-sys-body-medium-size));
  font-weight: var(--%NS%mat-list-list-item-supporting-text-weight, var(--%NS%mat-sys-body-medium-weight));
  letter-spacing: var(--%NS%mat-list-list-item-supporting-text-tracking, var(--%NS%mat-sys-body-medium-tracking));
}
.mdc-list-item__secondary-text::before {
  display: inline-block;
  width: 0;
  height: 20px;
  content: "";
  vertical-align: 0;
}
.mdc-list-item--with-three-lines .mdc-list-item__secondary-text {
  white-space: normal;
  line-height: 20px;
}
.mdc-list-item--with-overline .mdc-list-item__secondary-text {
  white-space: nowrap;
  line-height: auto;
}

.mdc-list-item--with-leading-radio.mdc-list-item,
.mdc-list-item--with-leading-checkbox.mdc-list-item,
.mdc-list-item--with-leading-icon.mdc-list-item,
.mdc-list-item--with-leading-avatar.mdc-list-item {
  padding-left: 0;
  padding-right: 16px;
}
[dir=rtl] .mdc-list-item--with-leading-radio.mdc-list-item,
[dir=rtl] .mdc-list-item--with-leading-checkbox.mdc-list-item,
[dir=rtl] .mdc-list-item--with-leading-icon.mdc-list-item,
[dir=rtl] .mdc-list-item--with-leading-avatar.mdc-list-item {
  padding-left: 16px;
  padding-right: 0;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__primary-text,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__primary-text,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines .mdc-list-item__primary-text,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text {
  display: block;
  margin-top: 0;
  line-height: normal;
  margin-bottom: -20px;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text::before {
  display: inline-block;
  width: 0;
  height: 32px;
  content: "";
  vertical-align: 0;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines .mdc-list-item__primary-text::after {
  display: inline-block;
  width: 0;
  height: 20px;
  content: "";
  vertical-align: -20px;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  display: block;
  margin-top: 0;
  line-height: normal;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before,
.mdc-list-item--with-leading-icon.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before,
.mdc-list-item--with-leading-avatar.mdc-list-item--with-two-lines.mdc-list-item--with-trailing-meta .mdc-list-item__end::before {
  display: inline-block;
  width: 0;
  height: 32px;
  content: "";
  vertical-align: 0;
}

.mdc-list-item--with-trailing-icon.mdc-list-item, [dir=rtl] .mdc-list-item--with-trailing-icon.mdc-list-item {
  padding-left: 0;
  padding-right: 0;
}
.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  margin-left: 16px;
  margin-right: 16px;
}

.mdc-list-item--with-trailing-meta.mdc-list-item {
  padding-left: 16px;
  padding-right: 0;
}
[dir=rtl] .mdc-list-item--with-trailing-meta.mdc-list-item {
  padding-left: 0;
  padding-right: 16px;
}
.mdc-list-item--with-trailing-meta .mdc-list-item__end {
  -webkit-user-select: none;
  user-select: none;
  margin-left: 28px;
  margin-right: 16px;
}
[dir=rtl] .mdc-list-item--with-trailing-meta .mdc-list-item__end {
  margin-left: 16px;
  margin-right: 28px;
}
.mdc-list-item--with-trailing-meta.mdc-list-item--with-three-lines .mdc-list-item__end, .mdc-list-item--with-trailing-meta.mdc-list-item--with-two-lines .mdc-list-item__end {
  display: block;
  line-height: normal;
  align-self: flex-start;
  margin-top: 0;
}
.mdc-list-item--with-trailing-meta.mdc-list-item--with-three-lines .mdc-list-item__end::before, .mdc-list-item--with-trailing-meta.mdc-list-item--with-two-lines .mdc-list-item__end::before {
  display: inline-block;
  width: 0;
  height: 28px;
  content: "";
  vertical-align: 0;
}

.mdc-list-item--with-leading-radio .mdc-list-item__start,
.mdc-list-item--with-leading-checkbox .mdc-list-item__start {
  margin-left: 8px;
  margin-right: 24px;
}
[dir=rtl] .mdc-list-item--with-leading-radio .mdc-list-item__start,
[dir=rtl] .mdc-list-item--with-leading-checkbox .mdc-list-item__start {
  margin-left: 24px;
  margin-right: 8px;
}
.mdc-list-item--with-leading-radio.mdc-list-item--with-two-lines .mdc-list-item__start,
.mdc-list-item--with-leading-checkbox.mdc-list-item--with-two-lines .mdc-list-item__start {
  align-self: flex-start;
  margin-top: 8px;
}

.mdc-list-item--with-trailing-radio.mdc-list-item,
.mdc-list-item--with-trailing-checkbox.mdc-list-item {
  padding-left: 16px;
  padding-right: 0;
}
[dir=rtl] .mdc-list-item--with-trailing-radio.mdc-list-item,
[dir=rtl] .mdc-list-item--with-trailing-checkbox.mdc-list-item {
  padding-left: 0;
  padding-right: 16px;
}
.mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-icon, .mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-avatar,
.mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-icon,
.mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-avatar {
  padding-left: 0;
}
[dir=rtl] .mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-icon, [dir=rtl] .mdc-list-item--with-trailing-radio.mdc-list-item--with-leading-avatar,
[dir=rtl] .mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-icon,
[dir=rtl] .mdc-list-item--with-trailing-checkbox.mdc-list-item--with-leading-avatar {
  padding-right: 0;
}
.mdc-list-item--with-trailing-radio .mdc-list-item__end,
.mdc-list-item--with-trailing-checkbox .mdc-list-item__end {
  margin-left: 24px;
  margin-right: 8px;
}
[dir=rtl] .mdc-list-item--with-trailing-radio .mdc-list-item__end,
[dir=rtl] .mdc-list-item--with-trailing-checkbox .mdc-list-item__end {
  margin-left: 8px;
  margin-right: 24px;
}
.mdc-list-item--with-trailing-radio.mdc-list-item--with-three-lines .mdc-list-item__end,
.mdc-list-item--with-trailing-checkbox.mdc-list-item--with-three-lines .mdc-list-item__end {
  align-self: flex-start;
  margin-top: 8px;
}

.mdc-list-group__subheader {
  margin: 0.75rem 16px;
}

.mdc-list-item--disabled .mdc-list-item__start,
.mdc-list-item--disabled .mdc-list-item__content,
.mdc-list-item--disabled .mdc-list-item__end {
  opacity: 1;
}
.mdc-list-item--disabled .mdc-list-item__primary-text,
.mdc-list-item--disabled .mdc-list-item__secondary-text {
  opacity: var(--%NS%mat-list-list-item-disabled-label-text-opacity, 0.3);
}
.mdc-list-item--disabled.mdc-list-item--with-leading-icon .mdc-list-item__start {
  color: var(--%NS%mat-list-list-item-disabled-leading-icon-color, var(--%NS%mat-sys-on-surface));
  opacity: var(--%NS%mat-list-list-item-disabled-leading-icon-opacity, 0.38);
}
.mdc-list-item--disabled.mdc-list-item--with-trailing-icon .mdc-list-item__end {
  color: var(--%NS%mat-list-list-item-disabled-trailing-icon-color, var(--%NS%mat-sys-on-surface));
  opacity: var(--%NS%mat-list-list-item-disabled-trailing-icon-opacity, 0.38);
}

.mat-mdc-list-item.mat-mdc-list-item-both-leading-and-trailing, [dir=rtl] .mat-mdc-list-item.mat-mdc-list-item-both-leading-and-trailing {
  padding-left: 0;
  padding-right: 0;
}

.mdc-list-item.mdc-list-item--disabled .mdc-list-item__primary-text {
  color: var(--%NS%mat-list-list-item-disabled-label-text-color, var(--%NS%mat-sys-on-surface));
}

.mdc-list-item:hover::before {
  background-color: var(--%NS%mat-list-list-item-hover-state-layer-color, var(--%NS%mat-sys-on-surface));
  opacity: var(--%NS%mat-list-list-item-hover-state-layer-opacity, var(--%NS%mat-sys-hover-state-layer-opacity));
}

.mdc-list-item.mdc-list-item--%NS%disabled::before {
  background-color: var(--%NS%mat-list-list-item-disabled-state-layer-color, var(--%NS%mat-sys-on-surface));
  opacity: var(--%NS%mat-list-list-item-disabled-state-layer-opacity, var(--%NS%mat-sys-focus-state-layer-opacity));
}

.mdc-list-item:focus::before {
  background-color: var(--%NS%mat-list-list-item-focus-state-layer-color, var(--%NS%mat-sys-on-surface));
  opacity: var(--%NS%mat-list-list-item-focus-state-layer-opacity, var(--%NS%mat-sys-focus-state-layer-opacity));
}

.mdc-list-item--disabled .mdc-radio,
.mdc-list-item--disabled .mdc-checkbox {
  opacity: var(--%NS%mat-list-list-item-disabled-label-text-opacity, 0.3);
}

.mdc-list-item--with-leading-avatar .mat-mdc-list-item-avatar {
  border-radius: var(--%NS%mat-list-list-item-leading-avatar-shape, var(--%NS%mat-sys-corner-full));
  background-color: var(--%NS%mat-list-list-item-leading-avatar-color, var(--%NS%mat-sys-primary-container));
}

.mat-mdc-list-item-icon {
  font-size: var(--%NS%mat-list-list-item-leading-icon-size, 24px);
}

@media (forced-colors: active) {
  a.mdc-list-item--%NS%activated::after {
    content: "";
    position: absolute;
    top: 50%;
    right: 16px;
    transform: translateY(-50%);
    width: 10px;
    height: 0;
    border-bottom: solid 10px;
    border-radius: 10px;
  }
  a.mdc-list-item--activated [dir=rtl]::after {
    right: auto;
    left: 16px;
  }
}

.mat-mdc-list-base {
  display: block;
}
.mat-mdc-list-base .mdc-list-item__start,
.mat-mdc-list-base .mdc-list-item__end,
.mat-mdc-list-base .mdc-list-item__content {
  pointer-events: auto;
}

.mat-mdc-list-item,
.mat-mdc-list-option {
  width: 100%;
  box-sizing: border-box;
  -webkit-tap-highlight-color: transparent;
}
.mat-mdc-list-item:not(.mat-mdc-list-item-interactive),
.mat-mdc-list-option:not(.mat-mdc-list-item-interactive) {
  cursor: default;
}
.mat-mdc-list-item .mat-divider-inset,
.mat-mdc-list-option .mat-divider-inset {
  position: absolute;
  left: 0;
  right: 0;
  bottom: 0;
}
.mat-mdc-list-item .mat-mdc-list-item-avatar ~ .mat-divider-inset,
.mat-mdc-list-option .mat-mdc-list-item-avatar ~ .mat-divider-inset {
  margin-left: 72px;
}
[dir=rtl] .mat-mdc-list-item .mat-mdc-list-item-avatar ~ .mat-divider-inset,
[dir=rtl] .mat-mdc-list-option .mat-mdc-list-item-avatar ~ .mat-divider-inset {
  margin-right: 72px;
}

.mat-mdc-list-item-interactive::before {
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  position: absolute;
  content: "";
  opacity: 0;
  pointer-events: none;
  border-radius: inherit;
}

.mat-mdc-list-item > .mat-focus-indicator {
  top: 0;
  left: 0;
  right: 0;
  bottom: 0;
  position: absolute;
  pointer-events: none;
}
.mat-mdc-list-item:focus-visible > .mat-focus-indicator::before {
  content: "";
}

.mat-mdc-list-item.mdc-list-item--with-three-lines .mat-mdc-list-item-line.mdc-list-item__secondary-text {
  white-space: nowrap;
  line-height: normal;
}
.mat-mdc-list-item.mdc-list-item--with-three-lines .mat-mdc-list-item-unscoped-content.mdc-list-item__secondary-text {
  display: -webkit-box;
  -webkit-box-orient: vertical;
  -webkit-line-clamp: 2;
}

mat-action-list button {
  background: none;
  color: inherit;
  border: none;
  font: inherit;
  outline: inherit;
  -webkit-tap-highlight-color: transparent;
  text-align: start;
}
mat-action-list button::-moz-focus-inner {
  border: 0;
}

.mdc-list-item--with-leading-icon .mdc-list-item__start {
  margin-inline-start: var(--%NS%mat-list-list-item-leading-icon-start-space, 16px);
  margin-inline-end: var(--%NS%mat-list-list-item-leading-icon-end-space, 16px);
}

.mat-mdc-nav-list .mat-mdc-list-item {
  border-radius: var(--%NS%mat-list-active-indicator-shape, var(--%NS%mat-sys-corner-full));
  --%NS%mat-focus-indicator-border-radius: var(--%NS%mat-list-active-indicator-shape, var(--%NS%mat-sys-corner-full));
}
.mat-mdc-nav-list .mat-mdc-list-item.mdc-list-item--activated {
  background-color: var(--%NS%mat-list-active-indicator-color, var(--%NS%mat-sys-secondary-container));
}
`],encapsulation:2})})()}return n})();var ue=(()=>{class n$1{static ɵfac=function(i){return new(i||n$1)};static ɵmod=Gy({type:n$1});static ɵinj=Jc({imports:[je,Et,n,oe,Lc]})}return n$1})();export{xe as a,ve as i,ci as n,ue as r,Yt as t};