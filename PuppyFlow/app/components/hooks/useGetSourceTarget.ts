import { useCallback } from "react";
import { useReactFlow } from "@xyflow/react";

function useGetSourceTarget() {
    const { getEdges, getNode } = useReactFlow();

    const getSourceNodeIdWithLabel = useCallback((parentId: string) => {
        return getEdges().filter(edge => edge.target === parentId).map(edge => edge.source).map(childnodeid => ({id: childnodeid, label: (getNode(childnodeid)?.data?.label as string | undefined) ?? childnodeid})).sort((a, b) => Number(a.id) - Number(b.id));
    }, [getEdges, getNode]);

    const getTargetNodeIdWithLabel = useCallback((parentId: string) => {
        return getEdges()
            .filter(edge => edge.source === parentId)
            .map(edge => edge.target)
            .map(childnodeid => ({
                id: childnodeid, 
                label: (getNode(childnodeid)?.data?.label as string | undefined) ?? childnodeid
            }))
            .sort((a, b) => Number(a.id) - Number(b.id));
    }, [getEdges, getNode]);

    return {
        getSourceNodeIdWithLabel,
        getTargetNodeIdWithLabel
    };
}

export default useGetSourceTarget;
