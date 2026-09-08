(function(g){
  'use strict';
  const EPS=1e-12;
  function tokenize(s){
    s=String(s).replace(/[−–—]/g,'-').replace(/×/g,'*').replace(/÷/g,'/').replace(/π/g,'pi').replace(/\s+/g,'');
    // fx-570ES-style compact combination/permutation notation: 5C2 / 5P2.
    s=s.replace(/(\d+(?:\.\d+)?)C(\d+(?:\.\d+)?)/gi,'comb($1,$2)').replace(/(\d+(?:\.\d+)?)P(\d+(?:\.\d+)?)/gi,'perm($1,$2)');
    const out=[]; let i=0;
    while(i<s.length){
      const c=s[i];
      if(/[0-9.]/.test(c)){
        const m=s.slice(i).match(/^(?:\d+(?:\.\d*)?|\.\d+)(?:[eE][+-]?\d+)?/); if(!m) throw new Error('숫자 오류'); out.push({t:'num',v:Number(m[0])}); i+=m[0].length; continue;
      }
      if(/[A-Za-z_]/.test(c)){
        const m=s.slice(i).match(/^[A-Za-z_][A-Za-z_0-9]*/)[0]; out.push({t:'id',v:m}); i+=m.length; continue;
      }
      if('+-*/^%!(),'.includes(c)){out.push({t:c,v:c});i++;continue}
      throw new Error('허용되지 않은 문자: '+c);
    }
    // Insert implicit multiplication between adjacent operands: 2pi, 2(x), (x)(y), 2sin(x)
    const prim = q => q && (q.t==='num' || q.t==='id' || q.t===')');
    const canStart = q => q && (q.t==='num' || q.t==='id' || q.t==='(');
    const fnNames = new Set(['sin','cos','tan','asin','acos','atan','sinh','cosh','tanh','sqrt','cbrt','log','ln','abs','exp','floor','ceil','round','fact','rand','comb','perm']);
    const withImplicit=[];
    for(let j=0;j<out.length;j++){ const a=out[j], b=out[j+1]; withImplicit.push(a); const functionCall = a?.t==='id' && b?.t==='(' && fnNames.has(String(a.v).toLowerCase()); if(prim(a) && canStart(b) && !functionCall) withImplicit.push({t:'*',v:'*'}); }
    return withImplicit;
  }
  function fact(n){if(n<0||Math.floor(n)!==n||n>170)throw new Error('팩토리얼 범위 오류');let r=1;for(let i=2;i<=n;i++)r*=i;return r}
  const BASE_FUNCTIONS={
    sin:[1,x=>x],cos:[1,x=>x],tan:[1,x=>x],asin:[1,x=>x],acos:[1,x=>x],atan:[1,x=>x],
    sinh:[1,Math.sinh],cosh:[1,Math.cosh],tanh:[1,Math.tanh],sqrt:[1,Math.sqrt],cbrt:[1,Math.cbrt],
    log:[1,Math.log10],ln:[1,Math.log],abs:[1,Math.abs],exp:[1,Math.exp],floor:[1,Math.floor],ceil:[1,Math.ceil],round:[1,Math.round],
    fact:[1,fact],rand:[0,()=>Math.random()],
    comb:[2,(n,r)=>fact(n)/(fact(r)*fact(n-r))],perm:[2,(n,r)=>fact(n)/fact(n-r)]
  };
  function parse(input,ctx,fnMap){
    const tk=tokenize(input), vars=ctx||{}, functions=fnMap||BASE_FUNCTIONS; let p=0;
    const peek=()=>tk[p]; const take=()=>tk[p++];
    function primary(){
      const q=peek();
      if(!q) throw new Error('식이 끝났습니다');
      if(q.t==='num'){take();return q.v}
      if(q.t==='id'){
        take(); const name=q.v;
        if(peek()?.t==='('){take(); const args=[]; if(peek()?.t!==')'){while(true){args.push(expr()); if(peek()?.t!==',')break;take()}} if(peek()?.t!==')')throw new Error('괄호 오류');take();
          const f=functions[name.toLowerCase()]; if(!f||f[0]!==args.length)throw new Error('함수 인자 오류'); return f[1](...args);
        }
        const key=name.toLowerCase(); if(key==='pi')return Math.PI;if(key==='e')return Math.E;if(key==='ans')return Number(vars.ans||0);if(key==='x')return Number(vars.x||0); if(Object.prototype.hasOwnProperty.call(vars,name))return Number(vars[name]); throw new Error('알 수 없는 기호: '+name);
      }
      if(q.t==='('){take();const v=expr();if(peek()?.t!==')')throw new Error('괄호 오류');take();return v}
      if(q.t==='+'){take();return +unary()}
      if(q.t==='-'){take();return -unary()}
      throw new Error('식 오류');
    }
    function postfix(){let v=primary(); while(peek()?.t==='!'||peek()?.t==='%'){const op=take().t;if(op==='!')v=fact(v);else v/=100} return v}
    function power(){let a=postfix(); if(peek()?.t==='^'){take();const b=unary();a=Math.pow(a,b)} return a}
    function unary(){if(peek()?.t==='+'||peek()?.t==='-')return primary();return power()}
    function term(){let v=unary(); while(peek()?.t==='*'||peek()?.t==='/'){const o=take().t,r=unary();v=o==='*'?v*r:v/r} return v}
    function expr(){let v=term(); while(peek()?.t==='+'||peek()?.t==='-'){const o=take().t,r=term();v=o==='+'?v+r:v-r} return v}
    const v=expr(); if(p!==tk.length)throw new Error('식 뒤에 불필요한 문자가 있습니다'); if(!Number.isFinite(v))throw new Error('Math ERROR'); return v;
  }
  function trigify(expr,angle,ctx){
    function tr(name,v){const r=angle==='DEG'?v*Math.PI/180:angle==='GRA'?v*Math.PI/200:v;return Math[name](r)}
    function inv(name,v){const f= name==='asin'?'asin':name==='acos'?'acos':'atan';let r=Math[f](v);return angle==='DEG'?r*180/Math.PI:angle==='GRA'?r*200/Math.PI:r}
    const localFns={...BASE_FUNCTIONS};
    localFns.sin=[1,v=>tr('sin',v)]; localFns.cos=[1,v=>tr('cos',v)]; localFns.tan=[1,v=>tr('tan',v)];
    localFns.asin=[1,v=>inv('asin',v)]; localFns.acos=[1,v=>inv('acos',v)]; localFns.atan=[1,v=>inv('atan',v)];
    return parse(expr,ctx||{},localFns);
  }
  function evaluate(expr,ctx,angle){
    const v=trigify(String(expr).replace(/\bANS\b/g,'ans'),angle||'DEG',ctx||{}); if(!Number.isFinite(v))throw new Error('Math ERROR'); return v;
  }
  g.CalcEngine={evaluate,fact,comb:(n,r)=>fact(n)/(fact(r)*fact(n-r)),perm:(n,r)=>fact(n)/fact(n-r)};
})(window);
