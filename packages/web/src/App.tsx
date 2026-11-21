import { useEffect, useState } from 'react';
import { Toasts } from './components';
import { Citizen, Join, Verify } from './Citizen';
import { Community } from './Community';
import { Home } from './Home';
import type { Lang } from './i18n';
import { Officer } from './Officer';

const route = () => location.hash.replace(/^#\/?/, '');

export function App() {
  const [r, setR] = useState(route());
  const [lang, setLangState] = useState<Lang>((localStorage.getItem('bp_lang') as Lang) ?? 'en');
  const setLang = (l: Lang) => { localStorage.setItem('bp_lang', l); setLangState(l); };
  useEffect(() => { const f = () => { setR(route()); window.scrollTo(0, 0); }; addEventListener('hashchange', f); return () => removeEventListener('hashchange', f); }, []);
  const verify = r.match(/^verify\/([^/]+)\/([^/]+)$/);
  const join = r.match(/^join\/([^/]+)$/);
  return (
    <>
      {verify ? <Verify id={decodeURIComponent(verify[1])} reporter={verify[2]} /> : join ? <Join id={decodeURIComponent(join[1])} lang={lang} setLang={setLang} /> : r.startsWith('community') ? <Community lang={lang} setLang={setLang} /> : r.startsWith('officer') ? <Officer /> : r.startsWith('citizen') ? <Citizen lang={lang} setLang={setLang} /> : <Home lang={lang} setLang={setLang} />}
      <Toasts />
    </>
  );
}
