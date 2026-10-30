/* Platform filter: progressive enhancement. Without JS every app is listed. */
(function(){
  var bar=document.querySelector('[data-filters]');
  var cards=[].slice.call(document.querySelectorAll('[data-platforms]'));
  var note=document.querySelector('[data-filter-note]');
  if(!bar||!cards.length)return;
  var NAMES={all:'All',android:'Android',ios:'iOS',windows:'Windows',macos:'macOS',web:'Web'};
  var buttons=[].slice.call(bar.querySelectorAll('button[data-platform]'));
  function apply(p,push){
    if(!NAMES[p])p='all';
    var shown=0,viaWeb=0;
    cards.forEach(function(c){
      var list=c.getAttribute('data-platforms').split(' ');
      var native=p==='all'||list.indexOf(p)>-1;
      var web=!native&&p!=='android'&&p!=='web'&&list.indexOf('web')>-1;
      c.hidden=!(native||web);
      if(native||web)shown++; if(web)viaWeb++;
    });
    buttons.forEach(function(b){b.setAttribute('aria-pressed',String(b.getAttribute('data-platform')===p))});
    var msg='';
    if(p!=='all'&&viaWeb&&viaWeb===shown)msg='No native '+NAMES[p]+' apps yet. These Web apps run in your browser on '+NAMES[p]+'.';
    else if(viaWeb)msg='Includes Web apps that run in your browser on '+NAMES[p]+'.';
    else if(!shown)msg='No '+NAMES[p]+' apps yet.';
    note.textContent=msg+(msg?' ':'')+'Showing '+shown+' of '+cards.length+' apps.';
    if(push){var h=p==='all'?location.pathname+location.search:'#'+p;history.replaceState(null,'',h)}
  }
  bar.hidden=false;
  bar.addEventListener('click',function(e){var b=e.target.closest('button[data-platform]');if(b)apply(b.getAttribute('data-platform'),true)});
  window.addEventListener('hashchange',function(){apply(location.hash.slice(1))});
  apply(location.hash.slice(1),false);
})();
