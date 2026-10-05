import { FormEvent, useEffect, useState } from 'react';
import { supabase } from '../services/supabaseClient';

function appBaseUrl() { return `${window.location.origin}${import.meta.env.BASE_URL}`; }
function params() {
  const search = new URLSearchParams(window.location.search);
  const hash = new URLSearchParams(window.location.hash.replace(/^#/, ''));
  return {
    tokenHash: search.get('token_hash') ?? hash.get('token_hash') ?? '',
    tokenType: search.get('type') ?? hash.get('type') ?? '',
    errorCode: search.get('error_code') ?? hash.get('error_code') ?? '',
    errorDescription: search.get('error_description') ?? hash.get('error_description') ?? '',
  };
}

export function RestaurantEmployeeInvitePage() {
  const [loading,setLoading]=useState(true);
  const [saving,setSaving]=useState(false);
  const [email,setEmail]=useState('');
  const [name,setName]=useState('');
  const [role,setRole]=useState('');
  const [tokenHash,setTokenHash]=useState('');
  const [tokenType,setTokenType]=useState<'invite'|'recovery'>('invite');
  const [password,setPassword]=useState('');
  const [confirmPassword,setConfirmPassword]=useState('');
  const [error,setError]=useState('');
  const [success,setSuccess]=useState(false);

  useEffect(()=>{let mounted=true;async function load(){if(!supabase){if(mounted){setError('Supabase is not configured.');setLoading(false)}return}
    const p=params();
    if(p.errorCode||p.errorDescription){if(mounted){setError(p.errorDescription||'This invitation is invalid or has expired.');setLoading(false)}return}
    if(p.tokenHash&&(p.tokenType==='invite'||p.tokenType==='recovery')){setTokenHash(p.tokenHash);setTokenType(p.tokenType as 'invite'|'recovery');setLoading(false);return}
    const hash=new URLSearchParams(window.location.hash.replace(/^#/,''));
    const access=hash.get('access_token'),refresh=hash.get('refresh_token'),type=hash.get('type');
    if((type==='invite'||type==='recovery')&&access&&refresh){setTokenType(type as 'invite'|'recovery');const {error}=await supabase.auth.setSession({access_token:access,refresh_token:refresh});if(error){if(mounted){setError(error.message);setLoading(false)}return}window.history.replaceState({},document.title,window.location.pathname+window.location.search)}
    const {data,error:sessionError}=await supabase.auth.getSession();if(!mounted)return;if(sessionError||!data.session?.user){setError(sessionError?.message||'This invitation is missing or has expired.');setLoading(false);return}
    const user=data.session.user;setEmail(user.email??'');setName(String(user.user_metadata?.name??''));setRole(String(user.user_metadata?.role??''));setLoading(false);
  }void load();return()=>{mounted=false}},[]);

  async function accept(){if(!supabase||!tokenHash)return;setSaving(true);setError('');const {data,error:verifyError}=await supabase.auth.verifyOtp({token_hash:tokenHash,type:tokenType});if(verifyError){setError(verifyError.message);setSaving(false);return}const user=data.user;if(!user){setError('The invitation was accepted but no account was returned.');setSaving(false);return}setEmail(user.email??'');setName(String(user.user_metadata?.name??''));setRole(String(user.user_metadata?.role??''));setTokenHash('');window.history.replaceState({},document.title,appBaseUrl()+'?employee-invite=1');setSaving(false)}
  async function submit(e:FormEvent<HTMLFormElement>){e.preventDefault();if(!supabase)return;setError('');if(password.length<8){setError('Password must be at least 8 characters.');return}if(password!==confirmPassword){setError('Passwords do not match.');return}setSaving(true);const {error:updateError}=await supabase.auth.updateUser({password});setSaving(false);if(updateError){setError(updateError.message);return}setSuccess(true)}
  if(loading)return <section className="restaurant-owner-auth-loading"><p>Preparing your invitation…</p></section>;
  return <section className="restaurant-employee-invite-page"><div className="restaurant-employee-invite-card"><p className="eyebrow">Employee invitation</p><h1>{success?'Your account is ready.':error?'Invitation link problem':`Welcome${name?`, ${name}`:''}.`}</h1>
    {error?<><p className="restaurant-employee-invite-error" role="alert">{error}</p><p>Ask the restaurant owner to send you a new invitation.</p><a className="button button-primary" href={appBaseUrl()}>Back to restaurant</a></>:
    success?<><p>Your password has been set for <strong>{email}</strong>.</p><p>You can now sign in with your employee account.</p><a className="button button-primary" href={appBaseUrl()+'#account'}>Continue to Sign in</a></>:
    tokenHash?<><p>{tokenType==='recovery'?'Your password setup link is ready. Continue to set your employee password.':'Your employee invitation is ready. Accept it to continue.'}</p><button className="button button-primary" type="button" onClick={()=>void accept()} disabled={saving}>{saving?'Accepting…':'Accept Invitation'}</button></>:
    <form onSubmit={(e)=>void submit(e)}><p>Set a password to finish creating your {role||'employee'} account.</p><label>Email<input type="email" value={email} readOnly /></label><label>Password<input type="password" value={password} onChange={e=>setPassword(e.target.value)} minLength={8} required /></label><label>Confirm password<input type="password" value={confirmPassword} onChange={e=>setConfirmPassword(e.target.value)} minLength={8} required /></label><button className="button button-primary" type="submit" disabled={saving}>{saving?'Saving…':'Set Password'}</button></form>}
  </div></section>;
}
