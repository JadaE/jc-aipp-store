/* Theme toggle: dark is the default; a light choice is remembered in localStorage. */
(function(){
  var KEY='aipp-theme', root=document.documentElement, btn=document.querySelector('[data-theme-toggle]');
  var meta=document.querySelector('meta[name="theme-color"]');
  function set(light,save){
    if(light)root.setAttribute('data-theme','light');else root.removeAttribute('data-theme');
    if(btn)btn.setAttribute('aria-pressed',String(light));
    if(meta)meta.setAttribute('content',light?'#f3f0fb':'#0a0e24');
    if(save){try{localStorage.setItem(KEY,light?'light':'dark')}catch(e){}}
  }
  set(root.getAttribute('data-theme')==='light',false);
  if(!btn)return;
  btn.hidden=false;
  btn.addEventListener('click',function(){set(root.getAttribute('data-theme')!=='light',true)});
})();
