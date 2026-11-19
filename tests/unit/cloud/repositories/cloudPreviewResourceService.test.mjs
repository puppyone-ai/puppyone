import { describe, expect, it, vi } from "vitest";
import { createCloudPreviewResourceService } from "../../../../electron/main/cloud-preview-resource-service.mjs";
import { isAllowedPdfResource } from "../../../../electron/main/embedded-pdf-security.mjs";

const base='https://cloud-fixture.puppyone.ai/api/v1';
const input={apiBaseUrl:base,projectId:'project',path:'scope/report.pdf',expectedSession:{userId:'owner',generation:'generation'}};
const signed=`${base}/content/project/inline?path=scope%2Freport.pdf&token=synthetic`;
function fixture() {
  let session={user_id:'owner',session_generation:'generation',api_base_url:base},clock=0;
  const auth={readSession:vi.fn(async()=>session),requestSessionApi:vi.fn(async()=>({url:signed}))};
  const service=createCloudPreviewResourceService({auth,now:()=>clock});
  return {auth,service,setSession:(value)=>{session=value;service.reconcileSession(value);},expire:()=>{clock=60*60*1000+1;}};
}
describe('Cloud preview authority in the embedded PDF policy',()=>{
  it('signs through native auth and grants only the exact retained resource',async()=>{
    const f=fixture();const {url}=await f.service.retain(7,input);
    expect(f.auth.requestSessionApi).toHaveBeenCalledWith(base,'/content/project/inline/sign',expect.objectContaining({body:JSON.stringify({path:input.path})}),input.expectedSession);
    expect(isAllowedPdfResource(url,f.service.allowed)).toBe(true);
    expect(isAllowedPdfResource(url+'#page=2',f.service.allowed)).toBe(true);
    for(const invalid of [url.replace('synthetic','forged'),url.replace('report.pdf','other.pdf'),base+'/private',url+'&extra=1'])
      expect(isAllowedPdfResource(invalid,f.service.allowed)).toBe(false);
    expect(isAllowedPdfResource(url)).toBe(false);
  });
  it('reference-counts identical backend signatures and restricts revocation to the owner',async()=>{
    const f=fixture();await f.service.retain(7,input);await f.service.retain(7,input);
    f.service.revoke(8,signed);f.service.revoke(7,signed);expect(f.service.allowed(signed)).toBe(true);
    f.service.revoke(7,signed);expect(f.service.allowed(signed)).toBe(false);
  });
  it('does not let PDF frames navigate into a retained HTML or media resource',async()=>{
    const f=fixture();
    for(const path of ['scope/page.html','scope/movie.mp4']) {
      const url=`${base}/content/project/inline?path=${encodeURIComponent(path)}&token=synthetic`;
      f.auth.requestSessionApi.mockResolvedValue({url});
      await f.service.retain(7,{...input,path});
      expect(isAllowedPdfResource(url,f.service.allowed)).toBe(false);
    }
  });
  it('revokes expired resources and account changes without revoking a same-session token refresh',async()=>{
    const f=fixture();await f.service.retain(7,input);
    f.setSession({user_id:'owner',session_generation:'generation',api_base_url:base});expect(f.service.allowed(signed)).toBe(true);
    f.setSession(null);expect(f.service.allowed(signed)).toBe(false);
    await expect(f.service.retain(7,input)).rejects.toMatchObject({code:'permission-denied'});
    const other=fixture();await other.service.retain(7,input);other.expire();expect(other.service.allowed(signed)).toBe(false);
  });
  it.each([signed.replace('cloud-fixture.puppyone.ai','other.test'),signed.replace('/project/','/other/'),signed.replace('report.pdf','other.pdf')])(
    'rejects a forged provider endpoint: %s',async(url)=>{
      const f=fixture();f.auth.requestSessionApi.mockResolvedValue({url});
      await expect(f.service.retain(7,input)).rejects.toMatchObject({code:'permission-denied'});
      expect(f.service.allowed(url)).toBe(false);
    });
  it('rejects a late signature after the requesting window retires',async()=>{
    const f=fixture();let finish;
    f.auth.requestSessionApi.mockImplementation(()=>new Promise(resolve=>{finish=resolve;}));
    const retaining=f.service.retain(7,input);void retaining.catch(()=>{});
    await vi.waitFor(()=>expect(finish).toBeTypeOf('function'));
    f.service.revokeOwner(7);finish({url:signed});
    await expect(retaining).rejects.toMatchObject({code:'permission-denied'});expect(f.service.allowed(signed)).toBe(false);
  });
});
