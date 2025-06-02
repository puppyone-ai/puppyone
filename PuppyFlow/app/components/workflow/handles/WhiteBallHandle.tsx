import React, { useEffect, useState } from 'react'
import { HandleProps, Handle, Position, Connection, useReactFlow } from '@xyflow/react'
import EdgeMenu1 from '../edgesNode/edgeNodesCreatingMenu/EdgeSelectorMenu'
import { useNodeContext } from '../../states/NodeContext'
import { useNodesPerFlowContext } from '../../states/NodesPerFlowContext'


type WhiteBallHandleProps = HandleProps & {
    sourceNodeId: string,
    // need a new prop: nodeType
}

type HandleNames = "TopSrcHandle" | "BottomSrcHandle" | "LeftSrcHandle" | "RightSrcHandle";


function WhiteBallHandle({ sourceNodeId, ...props }: WhiteBallHandleProps) {

    // console.log(sourceNodeId)
    // design handle bar with multiple handles, must add id for handle
    // const {nodes, searchNode, preventActivateNode, allowActivateNode, activateNode, preventInactivateNode, activateHandle, inactivateHandle, allowInactivateNode} = useNodeContext()
    const { activatedNode, activateNode, inactivateNode, setHandleActivated, preventInactivateNode, allowInactivateNodeWhenClickOutside, clearAll, clearEdgeActivation } = useNodesPerFlowContext()
    const { getNode } = useReactFlow()

    // const handlePositions = {
    //   [Position.Top]: 'TopSrcHandle',
    //   [Position.Bottom]: 'BottomSrcHandle',
    //   [Position.Left]: 'LeftSrcHandle',
    //   [Position.Right]: 'RightSrcHandle',
    // };
    // const handleName = handlePositions[props.position] as HandleNames;




    function judgeDisplay() {
        let showHandle = false
        const sourceNode = getNode(sourceNodeId)
        if (!sourceNode) return "transparent"
        // showHandle = sourceNode[handleName].isConnected



        // if (showHandle && !sourceNode.activated) return ""
        // else if (!showHandle && !sourceNode.activated) return "transparent"
        // else return "active"

        return (activatedNode?.id === sourceNodeId) ? "active" : "transparent"

    }


    const onClickAction = (event: React.MouseEvent<HTMLDivElement, MouseEvent>) => {
        event.preventDefault()
        event.stopPropagation()
        console.log(sourceNodeId, props.position)
        // onHandleClick(props.position)
        const sourceNode = getNode(sourceNodeId)
        if (!sourceNode) return
        if (activatedNode?.id !== sourceNodeId) {
            clearAll()
            // activateNode(sourceNodeId)
            setHandleActivated(sourceNodeId, props.position)

            // preventInactivateNodeWhenClickHandle()
        }
        else {

            if (activatedNode?.HandlePosition === props.position) {
                setHandleActivated(sourceNodeId, null)
                allowInactivateNodeWhenClickOutside()
            } else {
                // console.log(`activate node ${sourceNodeId}, handle ${props.position}, and preventInactivate node ${sourceNodeId}`)
                // activateHandle(sourceNodeId, props.position);
                // preventInactivateNode(sourceNodeId);
                // console.log("activate handle!!", props.position)
                setHandleActivated(sourceNodeId, props.position)
                clearEdgeActivation()
                preventInactivateNode()
            }

        }
        // if (selectedHandle === null) preventActivateNode()
        // else allowActivateNode()
    }

    const showHandleColor = () => {
        // const sourceNode = getNode(sourceNodeId)
        // if (!sourceNode) return ""
        // console.log(sourceNode, "show handle")
        return activatedNode?.id === sourceNodeId && activatedNode?.HandlePosition === props.position ? "selected" : ""
    }


    const getHandleStyle = () => {
        switch (props.position) {
            case Position.Top:
                return {
                    zIndex: 0,
                    top: '-16px',    // 向上偏移
                    // left: '50%',   // 可以添加水平居中
                };
            case Position.Bottom:
                return {
                    zIndex: 0,
                    bottom: '-16px',  // 向下偏移
                };
            case Position.Left:
                return {
                    zIndex: 0,
                    left: '-16px',    // 向左偏移
                };
            case Position.Right:
                return {
                    zIndex: 0,
                    right: '-16px',   // 向右偏移
                };
            default:
                return {
                    zIndex: 0,
                };
        }
    };

    const getHoverPreviewPosition = () => {
        switch (props.position) {
            case Position.Top:
                return 'absolute -top-[344px] -left-[80px]';
            case Position.Right:
                return 'absolute -top-[80px] left-[18px]';
            case Position.Bottom:
                return 'absolute top-[18px] -left-[80px]';
            case Position.Left:
                return 'absolute -top-[80px] -left-[408px]';
            default:
                return '';
        }
    };

    const getArrowRotation = () => {
        switch (props.position) {
            case Position.Top:
                return 'rotate-0';
            case Position.Right:
                return 'rotate-90';
            case Position.Bottom:
                return 'rotate-180';
            case Position.Left:
                return '-rotate-90';
            default:
                return '';
        }
    };

    return (
        <>
            <Handle
                id={props.id}
                type={props.type}
                position={props.position}
                onClick={(event) => onClickAction(event)}
                onConnect={(connection: Connection) => console.log(connection.source, connection.sourceHandle)}
                style={getHandleStyle()}
                className={`relative flex items-center justify-center z-10 ${judgeDisplay()} ${showHandleColor()}  hover:!border-main-orange hover:!w-[20px] hover:!h-[20px] hover:!border-2 hover:!rounded-[10px] group`}
            >
                <div className={`absolute z-[-10] inset-0 flex items-center justify-center text-main-orange opacity-0 group-hover:opacity-100 ${showHandleColor() === "selected" ? "opacity-100" : ""} pointer-events-none ${getArrowRotation()}`}>
                    <svg
                        width="12"
                        height="12"
                        viewBox="0 0 12 12"
                        fill="none"
                        xmlns="http://www.w3.org/2000/svg"
                    >
                        <path
                            d="M6 2L6 10M6 2L3 5M6 2L9 5"
                            stroke="currentColor"
                            strokeWidth="1.5"
                            strokeLinecap="round"
                            strokeLinejoin="round"
                        />
                    </svg>
                </div>
                <div className={`${getHoverPreviewPosition()} z-[-10] opacity-0 group-hover:opacity-100 pointer-events-none`}>
                    {props.position === Position.Top && (
                        <svg width="176" height="341" viewBox="0 0 176 341" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="86" y="181" width="4" height="160" fill="#565656" />
                            <rect x="58" y="247" width="60" height="28" rx="6" fill="#181818" />
                            <rect x="58" y="247" width="60" height="28" rx="6" stroke="#565656" strokeWidth="4" />
                            <path d="M79 188L88 179L97 188" stroke="#565656" strokeWidth="4" />
                            <rect x="2" y="2" width="172" height="172" rx="14" fill="#181818" />
                            <rect x="2" y="2" width="172" height="172" rx="14" stroke="#565655" strokeWidth="4" />
                        </svg>
                    )}
                    {props.position === Position.Right && (
                        <svg width="405" height="176" viewBox="0 0 405 176" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect y="86" width="224" height="4" fill="#565656" />
                            <path d="M217 79L226 88L217 97" stroke="#565656" strokeWidth="4" />
                            <rect x="231" y="2" width="172" height="172" rx="14" fill="#181818" />
                            <rect x="231" y="2" width="172" height="172" rx="14" stroke="#565655" strokeWidth="4" />
                            <rect x="82" y="74" width="60" height="28" rx="6" fill="#181818" />
                            <rect x="82" y="74" width="60" height="28" rx="6" stroke="#565656" strokeWidth="4" />
                        </svg>
                    )}
                    {props.position === Position.Bottom && (
                        <svg width="176" height="341" viewBox="0 0 176 341" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="86" y="0" width="4" height="160" fill="#565656" />
                            <rect x="58" y="66" width="60" height="28" rx="6" fill="#181818" />
                            <rect x="58" y="66" width="60" height="28" rx="6" stroke="#565656" strokeWidth="4" />
                            <path d="M79 153L88 162L97 153" stroke="#565656" strokeWidth="4" />
                            <rect x="2" y="167" width="172" height="172" rx="14" fill="#181818" />
                            <rect x="2" y="167" width="172" height="172" rx="14" stroke="#565655" strokeWidth="4" />
                        </svg>
                    )}
                    {props.position === Position.Left && (
                        <svg width="405" height="176" viewBox="0 0 405 176" fill="none" xmlns="http://www.w3.org/2000/svg">
                            <rect x="181" y="86" width="224" height="4" fill="#565656" />
                            <path d="M188 79L179 88L188 97" stroke="#565656" strokeWidth="4" />
                            <rect x="2" y="2" width="172" height="172" rx="14" fill="#181818" />
                            <rect x="2" y="2" width="172" height="172" rx="14" stroke="#565655" strokeWidth="4" />
                            <rect x="263" y="74" width="60" height="28" rx="6" fill="#181818" />
                            <rect x="263" y="74" width="60" height="28" rx="6" stroke="#565656" strokeWidth="4" />
                        </svg>
                    )}
                </div>
            </Handle>
            <EdgeMenu1
                nodeType={getNode(sourceNodeId)?.type || "text"}
                sourceNodeId={sourceNodeId}
                handleId={props.id}
                position={props.position}
            />
        </>
    );
}

export default WhiteBallHandle


