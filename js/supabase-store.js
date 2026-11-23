// Общая работа с Supabase. В config.js указываются только публичные URL/key.
(function(){
  const cfg=window.SUPABASE_CONFIG||{};
  const valid=cfg.url && cfg.anonKey && !cfg.url.includes('YOUR-PROJECT') && !cfg.anonKey.includes('YOUR_SUPABASE');
  window.supabaseReady=!!(valid && window.supabase);
  window.sb=window.supabaseReady ? window.supabase.createClient(cfg.url,cfg.anonKey) : null;

  // Retry с экспоненциальной задержкой для временных сетевых ошибок Supabase.
  window.supabaseWithRetry=async function(fn, options={}){
    const maxAttempts=options.maxAttempts||3;
    const baseDelay=options.baseDelay||500;
    const maxDelay=options.maxDelay||5000;
    let lastError=null;
    for(let attempt=1;attempt<=maxAttempts;attempt++){
      try{
        return await fn();
      }catch(error){
        lastError=error;
        const message=String(error?.message||error).toLocaleLowerCase('en');
        const isTransient=message.includes('failed to fetch')||message.includes('network')||message.includes('timeout')||message.includes('503')||message.includes('502')||message.includes('504');
        if(!isTransient||attempt===maxAttempts) break;
        const delay=Math.min(maxDelay,baseDelay*Math.pow(2,attempt-1));
        await new Promise(resolve=>setTimeout(resolve,delay));
      }
    }
    throw lastError;
  };

  window.loadRemoteProducts=async function(){
    if(!window.sb) return null;
    try{
      const result=await window.supabaseWithRetry(async()=>{
        const {data,error}=await window.sb.from('products')
          .select('id,avito_id,name,price,seller,category,year,image,photos,link,description,available')
          .order('id',{ascending:false});
        if(error) throw error;
        return data||[];
      },{maxAttempts:3});
      return result.map(p=>{
        return {
          id:p.id, avitoId:p.avito_id || String(p.id), name:p.name, price:p.price,
          seller:p.seller||'Старинная Коллекция', category:p.category||'Разное',
          year:p.year||'', image:p.image||'', photos:Array.isArray(p.photos)?p.photos:[],
          link:p.link||'', description:p.description||'',
          available:p.available!==false
        };
      });
    }catch(error){
      console.error('Не удалось загрузить каталог из Supabase:',error?.message||error);
      return null;
    }
  };
})();
