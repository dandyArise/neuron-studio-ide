export const effortLabels:Record<string,string>={off:'Désactivé',on:'Activé',low:'Faible',medium:'Moyen',high:'Élevé',xhigh:'Très élevé'}
export type LocalModel={id:string,loaded:boolean,options:string[]}
export function reasoningOptions(models:LocalModel[],id:string){
  const selected=id?models.find(m=>m.id===id):models.find(m=>m.loaded)
  return selected?.options.filter(value=>Object.hasOwn(effortLabels,value))??[]
}
