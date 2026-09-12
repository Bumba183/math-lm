// AiTunnel / OpenAI-совместимый провайдер для Ticket Courier Dashboard.
//
// Вставляется в дашборд перед claudeApiRequest(); дальше достаточно одной строки
// внутри claudeApiRequest: if(getAiProvider()==='openai') return openaiApiRequest(...).
// Ответ приводится к виду Claude, поэтому разбор ответа и обработка ошибок остаются прежними.
//
// Нужно окружение дашборда: cfg, DEF, gmHttpRequest, aiSleep, isAiRetryableStatus,
// claudeApiErrorMessage, logAiError, showAiNotification.
// В шапку юзерскрипта: // @connect api.aitunnel.ru
// Ключ хранится в настройках (cfg.openaiApiKey) и в код не попадает.

// ---------- AiTunnel / OpenAI-совместимый провайдер ----------
function getOpenAiBase(){
  return String(cfg.openaiApiBase||DEF.openaiApiBase||'https://api.aitunnel.ru/v1').trim().replace(/\/+$/,'');
}
function getOpenAiUrl(){
  const b=getOpenAiBase();
  if(/\/chat\/completions$/i.test(b)) return b;
  return /\/v\d+$/i.test(b)?b+'/chat/completions':b+'/v1/chat/completions';
}
function getOpenAiModel(role,purpose){
  if(purpose==='reviewer') return String(cfg.openaiModelReviewer||DEF.openaiModelReviewer||'gpt-5-6-luna-pro').trim();
  const map={triage:cfg.openaiModelTriage,review:cfg.openaiModelReview,decision:cfg.openaiModelDecision};
  const def={triage:DEF.openaiModelTriage,review:DEF.openaiModelReview,decision:DEF.openaiModelDecision};
  return String(map[role]||def[role]||DEF.openaiModelDecision||'gpt-5-6-luna-pro').trim();
}
function buildOpenAiUserContent(text,images){
  if(!images||!images.length) return String(text||'');
  const blocks=[{type:'text',text:String(text||'')}];
  images.forEach(img=>{
    if(!img||!img.data) return;
    blocks.push({type:'image_url',image_url:{url:'data:'+(img.mime||img.media_type||'image/jpeg')+';base64,'+img.data}});
  });
  return blocks;
}
// Ответ приводим к виду Claude — весь разбор ниже по коду остаётся прежним
function openAiResponseAdapter(resp){
  const raw=resp.json();
  let text='';
  if(raw&&Array.isArray(raw.choices)&&raw.choices.length){
    const m=raw.choices[0].message||{};
    if(typeof m.content==='string') text=m.content;
    else if(Array.isArray(m.content)) text=m.content.map(b=>b&&(b.text||b.content||'')).join('\n');
    if(!text&&typeof raw.choices[0].text==='string') text=raw.choices[0].text;
  }
  return{
    status:resp.status,
    ok:resp.ok,
    text:resp.text,
    json(){return resp.ok?{content:[{type:'text',text:text}]}:raw;}
  };
}
async function openaiApiRequest(messages,system,images,model,meta,opts){
  opts=opts||{};
  const url=getOpenAiUrl();
  const key=String(cfg.openaiApiKey||'').trim();
  const headers={'Content-Type':'application/json','Accept':'application/json'};
  if(key) headers['Authorization']='Bearer '+key;
  const userContent=Array.isArray(messages)&&messages.length?messages[messages.length-1].content:null;
  const userText=typeof userContent==='string'?userContent:(Array.isArray(userContent)?userContent.filter(b=>b&&b.type==='text').map(b=>b.text).join('\n'):String(messages&&messages[0]&&messages[0].content||''));
  const apiMessages=[];
  if(system) apiMessages.push({role:'system',content:String(system)});
  apiMessages.push({role:'user',content:buildOpenAiUserContent(userText,images)});

  let tokensKey='max_tokens';
  let sendTemperature=true;
  const buildBody=()=>{
    const body={model:String(model||getOpenAiModel('decision')).trim(),messages:apiMessages};
    body[tokensKey]=opts.max_tokens!=null?opts.max_tokens:2048;
    if(sendTemperature) body.temperature=opts.temperature!=null?opts.temperature:0;
    if(cfg.openaiJsonMode) body.response_format={type:'json_object'};
    return body;
  };
  const retries=Math.max(0,Math.min(4,cfg.cursorApiRetries!=null?+cfg.cursorApiRetries:DEF.cursorApiRetries||0));
  const baseDelay=Math.max(250,cfg.cursorApiRetryBaseMs!=null?+cfg.cursorApiRetryBaseMs:DEF.cursorApiRetryBaseMs||900);
  let lastErr=null,lastResp=null,fixed=0;
  for(let attempt=0;attempt<=retries;attempt++){
    try{
      const resp=await gmHttpRequest({method:'POST',url,headers,data:JSON.stringify(buildBody())},'OpenAI API');
      // Шлюзы отличаются: часть моделей не принимает max_tokens или temperature — чиним параметр и пробуем снова
      if(!resp.ok&&resp.status===400&&fixed<2){
        const msg=String(claudeApiErrorMessage(resp)||'').toLowerCase();
        if(msg.includes('max_completion_tokens')&&tokensKey!=='max_completion_tokens'){tokensKey='max_completion_tokens';fixed++;attempt--;continue;}
        if(msg.includes('temperature')&&sendTemperature){sendTemperature=false;fixed++;attempt--;continue;}
      }
      if(resp.ok||!isAiRetryableStatus(resp.status)||attempt>=retries) return openAiResponseAdapter(resp);
      lastResp=resp;
      await aiSleep(baseDelay*Math.pow(2,attempt)+Math.round(Math.random()*180));
    }catch(e){
      lastErr=e;
      if(attempt>=retries) break;
      await aiSleep(baseDelay*Math.pow(2,attempt)+Math.round(Math.random()*180));
    }
  }
  const msg=lastResp?('HTTP '+lastResp.status+': '+claudeApiErrorMessage(lastResp)):String(lastErr&&lastErr.message||lastErr||'OpenAI API failed');
  logAiError(Object.assign({category:'api',phase:meta&&meta.phase||'request',provider:'openai',method:'POST',path:'/chat/completions',message:msg,attempts:retries+1},meta||{}));
  showAiNotification('api_error',meta&&meta.ticketId,msg,meta&&meta.href);
  if(lastResp) return openAiResponseAdapter(lastResp);
  throw lastErr||new Error(msg);
}
