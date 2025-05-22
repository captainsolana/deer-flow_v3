// Copyright (c) 2025 Bytedance Ltd. and/or its affiliates
// SPDX-License-Identifier: MIT

import { nanoid } from "nanoid";
import { toast } from "sonner";
import { create } from "zustand";
import { persist, createJSONStorage } from "zustand/middleware";
import { useShallow } from "zustand/react/shallow";

import { chatStream, generatePodcast } from "../api";
import type { Message } from "../messages";
import { mergeMessage } from "../messages";
import { parseJSON } from "../utils";

import { getChatStreamSettings } from "./settings-store";

interface StoreState {
  responding: boolean;
  threadId: string;
  messageIds: string[];
  messages: Map<string, Message>;
  researchIds: string[];
  researchPlanIds: Map<string, string>;
  researchReportIds: Map<string, string>;
  researchActivityIds: Map<string, string[]>;
  ongoingResearchId: string | null;
  openResearchId: string | null;
}

interface StoreActions {
  appendMessage: (message: Message) => void;
  updateMessage: (message: Message) => void;
  updateMessages: (messages: Message[]) => void;
  openResearch: (researchId: string | null) => void;
  closeResearch: () => void;
  setOngoingResearch: (researchId: string | null) => void;
  initializeNewThread: () => void;
}

type StoreStateAndActions = StoreState & StoreActions;

export const useStore = create(
  persist<StoreStateAndActions>(
    (set, get) => ({
      responding: false,
      threadId: nanoid(), // Initialize threadId here
      messageIds: [],
      messages: new Map<string, Message>(),
      researchIds: [],
      researchPlanIds: new Map<string, string>(),
      researchReportIds: new Map<string, string>(),
      researchActivityIds: new Map<string, string[]>(),
      ongoingResearchId: null,
      openResearchId: null,

      appendMessage(message: Message) {
    set((state) => ({
      messageIds: [...state.messageIds, message.id],
      messages: new Map(state.messages).set(message.id, message),
    }));
  },
  updateMessage(message: Message) {
    set((state) => ({
      messages: new Map(state.messages).set(message.id, message),
    }));
  },
  updateMessages(messages: Message[]) {
    set((state) => {
      const newMessages = new Map(state.messages);
      messages.forEach((m) => newMessages.set(m.id, m));
      return { messages: newMessages };
    });
  },
  openResearch(researchId: string | null) {
    set({ openResearchId: researchId });
  },
  closeResearch() {
    set({ openResearchId: null });
  },
  setOngoingResearch(researchId: string | null) {
    set({ ongoingResearchId: researchId });
  },
  initializeNewThread: () => {
    set({
      threadId: nanoid(),
      messageIds: [],
      messages: new Map(),
      // Optionally reset research states too
      researchIds: [],
      researchPlanIds: new Map(),
      researchReportIds: new Map(),
      researchActivityIds: new Map(),
      ongoingResearchId: null,
      openResearchId: null,
    });
  },
}),
{
  name: "deerflow-chat-storage",
  storage: createJSONStorage(() => localStorage),
  partialize: (state) => ({
    threadId: state.threadId,
    messageIds: state.messageIds,
    messages: Array.from(state.messages.entries()),
    researchIds: state.researchIds,
    researchPlanIds: Array.from(state.researchPlanIds.entries()),
    researchReportIds: Array.from(state.researchReportIds.entries()),
    researchActivityIds: Array.from(state.researchActivityIds.entries()),
    ongoingResearchId: state.ongoingResearchId,
    openResearchId: state.openResearchId,
  }),
  merge: (persistedState, currentState) => {
    const loadedState = persistedState as any; // Cast to any to handle array form of messages
    // Start with current state as base, then overwrite with persisted items
    const mergedState = { ...currentState, ...loadedState };

    if (loadedState.messages && Array.isArray(loadedState.messages)) {
      mergedState.messages = new Map(loadedState.messages);
    } else {
      // If persisted is not an array (e.g. old format or error), keep current state's map or initialize new
      mergedState.messages = currentState.messages || new Map();
    }

    if (loadedState.researchPlanIds && Array.isArray(loadedState.researchPlanIds)) {
      mergedState.researchPlanIds = new Map(loadedState.researchPlanIds);
    } else {
      mergedState.researchPlanIds = currentState.researchPlanIds || new Map();
    }

    if (loadedState.researchReportIds && Array.isArray(loadedState.researchReportIds)) {
      mergedState.researchReportIds = new Map(loadedState.researchReportIds);
    } else {
      mergedState.researchReportIds = currentState.researchReportIds || new Map();
    }

    if (loadedState.researchActivityIds && Array.isArray(loadedState.researchActivityIds)) {
      mergedState.researchActivityIds = new Map(loadedState.researchActivityIds);
    } else {
      mergedState.researchActivityIds = currentState.researchActivityIds || new Map();
    }
    return mergedState;
  },
  onRehydrateStorage: () => {
    return (rehydratedState, error) => {
      if (error) {
        console.error("Failed to rehydrate state from localStorage:", error);
      }
      // If threadId was not in the rehydratedState, it would be initialized by the default value in create() (i.e. nanoid())
      // If rehydratedState exists and has a threadId, it will be used.
      // If rehydratedState is undefined (e.g. first time, no storage), initial state from create() is used.
      if (rehydratedState && !rehydratedState.threadId) {
         // This case should ideally be handled by ensuring `threadId: nanoid()` in the initial state.
         // If `threadId` could be `undefined` in storage from a previous version,
         // we might need to explicitly set it here using `useStore.getState().initializeNewThread()`
         // or `useStore.setState({ threadId: nanoid() })` but that's usually done outside `onRehydrateStorage`
         // or by ensuring the initial state is robust.
         // For now, we rely on `threadId: nanoid()` in the main `create` call.
      }
    };
  },
}
)
);

export async function sendMessage(
  content?: string,
  {
    interruptFeedback,
  }: {
    interruptFeedback?: string;
  } = {},
  options: { abortSignal?: AbortSignal } = {},
) {
  const currentThreadId = useStore.getState().threadId;
  if (content != null) {
    appendMessage({
      id: nanoid(),
      threadId: currentThreadId, // Use threadId from store
      role: "user",
      content: content,
      contentChunks: [content],
    });
  }

  const settings = getChatStreamSettings();
  const stream = chatStream(
    content ?? "[REPLAY]",
    {
      thread_id: currentThreadId, // Use threadId from store
      interrupt_feedback: interruptFeedback,
      auto_accepted_plan: settings.autoAcceptedPlan,
      enable_background_investigation:
        settings.enableBackgroundInvestigation ?? true,
      max_plan_iterations: settings.maxPlanIterations,
      max_step_num: settings.maxStepNum,
      max_search_results: settings.maxSearchResults,
      mcp_settings: settings.mcpSettings,
    },
    options,
  );

  setResponding(true);
  let messageId: string | undefined;
  try {
    for await (const event of stream) {
      const { type, data } = event;
      messageId = data.id;
      let message: Message | undefined;
      if (type === "tool_call_result") {
        message = findMessageByToolCallId(data.tool_call_id);
      } else if (!existsMessage(messageId)) {
        message = {
          id: messageId,
          threadId: data.thread_id,
          agent: data.agent,
          role: data.role,
          content: "",
          contentChunks: [],
          isStreaming: true,
          interruptFeedback,
        };
        appendMessage(message);
      }
      message ??= getMessage(messageId);
      if (message) {
        message = mergeMessage(message, event);
        updateMessage(message);
      }
    }
  } catch {
    toast("An error occurred while generating the response. Please try again.");
    // Update message status.
    // TODO: const isAborted = (error as Error).name === "AbortError";
    if (messageId != null) {
      const message = getMessage(messageId);
      if (message?.isStreaming) {
        message.isStreaming = false;
        useStore.getState().updateMessage(message);
      }
    }
    useStore.getState().setOngoingResearch(null);
  } finally {
    setResponding(false);
  }
}

function setResponding(value: boolean) {
  useStore.setState({ responding: value });
}

function existsMessage(id: string) {
  return useStore.getState().messageIds.includes(id);
}

function getMessage(id: string) {
  return useStore.getState().messages.get(id);
}

function findMessageByToolCallId(toolCallId: string) {
  return Array.from(useStore.getState().messages.values())
    .reverse()
    .find((message) => {
      if (message.toolCalls) {
        return message.toolCalls.some((toolCall) => toolCall.id === toolCallId);
      }
      return false;
    });
}

function appendMessage(message: Message) {
  if (
    message.agent === "coder" ||
    message.agent === "reporter" ||
    message.agent === "researcher"
  ) {
    if (!getOngoingResearchId()) {
      const id = message.id;
      appendResearch(id);
      openResearch(id);
    }
    appendResearchActivity(message);
  }
  useStore.getState().appendMessage(message);
}

function updateMessage(message: Message) {
  if (
    getOngoingResearchId() &&
    message.agent === "reporter" &&
    !message.isStreaming
  ) {
    useStore.getState().setOngoingResearch(null);
  }
  useStore.getState().updateMessage(message);
}

function getOngoingResearchId() {
  return useStore.getState().ongoingResearchId;
}

function appendResearch(researchId: string) {
  let planMessage: Message | undefined;
  const reversedMessageIds = [...useStore.getState().messageIds].reverse();
  for (const messageId of reversedMessageIds) {
    const message = getMessage(messageId);
    if (message?.agent === "planner") {
      planMessage = message;
      break;
    }
  }
  const messageIds = [researchId];
  messageIds.unshift(planMessage!.id);
  useStore.setState({
    ongoingResearchId: researchId,
    researchIds: [...useStore.getState().researchIds, researchId],
    researchPlanIds: new Map(useStore.getState().researchPlanIds).set(
      researchId,
      planMessage!.id,
    ),
    researchActivityIds: new Map(useStore.getState().researchActivityIds).set(
      researchId,
      messageIds,
    ),
  });
}

function appendResearchActivity(message: Message) {
  const researchId = getOngoingResearchId();
  if (researchId) {
    const researchActivityIds = useStore.getState().researchActivityIds;
    const current = researchActivityIds.get(researchId)!;
    if (!current.includes(message.id)) {
      useStore.setState({
        researchActivityIds: new Map(researchActivityIds).set(researchId, [
          ...current,
          message.id,
        ]),
      });
    }
    if (message.agent === "reporter") {
      useStore.setState({
        researchReportIds: new Map(useStore.getState().researchReportIds).set(
          researchId,
          message.id,
        ),
      });
    }
  }
}

export function openResearch(researchId: string | null) {
  useStore.getState().openResearch(researchId);
}

export function closeResearch() {
  useStore.getState().closeResearch();
}

export async function listenToPodcast(researchId: string) {
  const planMessageId = useStore.getState().researchPlanIds.get(researchId);
  const reportMessageId = useStore.getState().researchReportIds.get(researchId);
  if (planMessageId && reportMessageId) {
    const planMessage = getMessage(planMessageId)!;
    const title = parseJSON(planMessage.content, { title: "Untitled" }).title;
    const reportMessage = getMessage(reportMessageId);
    if (reportMessage?.content) {
      appendMessage({
        id: nanoid(),
        threadId: useStore.getState().threadId, // Use threadId from store
        role: "user",
        content: "Please generate a podcast for the above research.",
        contentChunks: [],
      });
      const podCastMessageId = nanoid();
      const podcastObject = { title, researchId };
      const podcastMessage: Message = {
        id: podCastMessageId,
        threadId: useStore.getState().threadId, // Use threadId from store
        role: "assistant",
        agent: "podcast",
        content: JSON.stringify(podcastObject),
        contentChunks: [],
        isStreaming: true,
      };
      appendMessage(podcastMessage);
      // Generating podcast...
      let audioUrl: string | undefined;
      try {
        audioUrl = await generatePodcast(reportMessage.content);
      } catch (e) {
        console.error(e);
        useStore.setState((state) => ({
          messages: new Map(useStore.getState().messages).set(
            podCastMessageId,
            {
              ...state.messages.get(podCastMessageId)!,
              content: JSON.stringify({
                ...podcastObject,
                error: e instanceof Error ? e.message : "Unknown error",
              }),
              isStreaming: false,
            },
          ),
        }));
        toast("An error occurred while generating podcast. Please try again.");
        return;
      }
      useStore.setState((state) => ({
        messages: new Map(useStore.getState().messages).set(podCastMessageId, {
          ...state.messages.get(podCastMessageId)!,
          content: JSON.stringify({ ...podcastObject, audioUrl }),
          isStreaming: false,
        }),
      }));
    }
  }
}

export function useResearchMessage(researchId: string) {
  return useStore(
    useShallow((state) => {
      const messageId = state.researchPlanIds.get(researchId);
      return messageId ? state.messages.get(messageId) : undefined;
    }),
  );
}

export function useMessage(messageId: string | null | undefined) {
  return useStore(
    useShallow((state) =>
      messageId ? state.messages.get(messageId) : undefined,
    ),
  );
}

export function useMessageIds() {
  return useStore(useShallow((state) => state.messageIds));
}

export function useLastInterruptMessage() {
  return useStore(
    useShallow((state) => {
      if (state.messageIds.length >= 2) {
        const lastMessage = state.messages.get(
          state.messageIds[state.messageIds.length - 1]!,
        );
        return lastMessage?.finishReason === "interrupt" ? lastMessage : null;
      }
      return null;
    }),
  );
}

export function useLastFeedbackMessageId() {
  const waitingForFeedbackMessageId = useStore(
    useShallow((state) => {
      if (state.messageIds.length >= 2) {
        const lastMessage = state.messages.get(
          state.messageIds[state.messageIds.length - 1]!,
        );
        if (lastMessage && lastMessage.finishReason === "interrupt") {
          return state.messageIds[state.messageIds.length - 2];
        }
      }
      return null;
    }),
  );
  return waitingForFeedbackMessageId;
}

export function useToolCalls() {
  return useStore(
    useShallow((state) => {
      return state.messageIds
        ?.map((id) => getMessage(id)?.toolCalls)
        .filter((toolCalls) => toolCalls != null)
        .flat();
    }),
  );
}
