import React, { useState, useEffect, useCallback, useRef } from 'react';
import {
  View,
  Text,
  TextInput,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Platform,
} from 'react-native';
import { tasksApi, authApi, ApiError } from '../api/client';
import { useSessionStore } from '../store/session';

export default function TaskSelectionScreen() {
  const setUser = useSessionStore((state) => state.setUser);
  
  const [loading, setLoading] = useState(true);
  const [submitting, setSubmitting] = useState(false);
  const [error, setError] = useState('');
  
  const [categories, setCategories] = useState([]);
  const [searchQuery, setSearchQuery] = useState('');
  const [searching, setSearching] = useState(false);
  const [searchError, setSearchError] = useState('');
  
  const searchSeq = useRef(0);
  const lastSearchedQuery = useRef('');
  
  const [selectedTaskIds, setSelectedTaskIds] = useState(new Set());

  const fetchInitialData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalogRes, myTasksRes] = await Promise.all([
        tasksApi.getTasks(),
        tasksApi.getMyTasks()
      ]);
      
      setCategories(catalogRes?.categories || []);
      
      const initialSet = new Set((myTasksRes.tasks || []).map(t => t.id));
      setSelectedTaskIds(initialSet);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load tasks. Please check your connection and try again.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    fetchInitialData();
  }, [fetchInitialData]);

  const handleSearch = useCallback(async (query) => {
    lastSearchedQuery.current = query;
    setSearchQuery(query);
    setSearching(true);
    setSearchError('');
    
    const seq = ++searchSeq.current;
    try {
      const catalogRes = await tasksApi.getTasks(query);
      if (seq === searchSeq.current) {
        setCategories(catalogRes?.categories || []);
      }
    } catch (err) {
      if (seq === searchSeq.current) {
        setSearchError('Search failed. Please check your connection.');
      }
    } finally {
      if (seq === searchSeq.current) {
        setSearching(false);
      }
    }
  }, []);

  // Debounce search slightly (optional, but good practice if it's hitting network on every keystroke)
  useEffect(() => {
    const handler = setTimeout(() => {
      if (!loading && searchQuery !== lastSearchedQuery.current) { 
        handleSearch(searchQuery);
      }
    }, 500);
    return () => clearTimeout(handler);
  }, [searchQuery, loading, handleSearch]);

  const toggleTask = (taskId) => {
    const nextSet = new Set(selectedTaskIds);
    if (nextSet.has(taskId)) {
      nextSet.delete(taskId);
    } else {
      nextSet.add(taskId);
    }
    setSelectedTaskIds(nextSet);
  };

  const handleConfirm = async () => {
    setSubmitting(true);
    setError('');
    
    try {
      const taskIds = Array.from(selectedTaskIds);
      await tasksApi.updateMyTasks(taskIds);
      
      // Refresh /auth/me to update selectedTaskCount and advance route gate
      const meResponse = await authApi.getMe();
      setUser(meResponse);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('An unexpected error occurred while saving your selection.');
      }
    } finally {
      setSubmitting(false);
    }
  };

  if (loading) {
    return (
      <View className="flex-1 justify-center items-center bg-[#FAFAF7]">
        <ActivityIndicator size="large" color="#126A56" />
      </View>
    );
  }

  if (error && categories.length === 0 && selectedTaskIds.size === 0) {
    return (
      <View className="flex-1 justify-center items-center bg-[#FAFAF7] p-6">
        <Text className="text-red-600 text-center mb-4">{error}</Text>
        <TouchableOpacity 
          className="bg-[#126A56] py-3 px-6 rounded-xl"
          onPress={fetchInitialData}
        >
          <Text className="text-white font-semibold">Retry</Text>
        </TouchableOpacity>
      </View>
    );
  }

  // Flatten catalog into a list for FlatList
  const listData = [];
  categories.forEach(category => {
    if (category.tasks && category.tasks.length > 0) {
      listData.push({ type: 'header', id: `header-${category.id}`, name: category.name });
      category.tasks.forEach(task => {
        listData.push({ type: 'task', id: task.id, ...task });
      });
    }
  });

  const renderItem = ({ item }) => {
    if (item.type === 'header') {
      return (
        <View className="mt-6 mb-2 px-6">
          <Text className="text-lg font-semibold text-slate-800">{item.name}</Text>
        </View>
      );
    }

    const isSelected = selectedTaskIds.has(item.id);

    return (
      <TouchableOpacity
        className={`mx-6 mb-3 p-4 rounded-xl border flex-row items-center justify-between shadow-sm ${isSelected ? 'bg-[#E6F4F1] border-[#126A56]' : 'bg-white border-slate-200'}`}
        onPress={() => toggleTask(item.id)}
        disabled={submitting}
        activeOpacity={0.7}
      >
        <View className="flex-1 mr-4">
          <Text className={`text-base font-medium ${isSelected ? 'text-[#126A56]' : 'text-slate-800'}`}>
            {item.name}
          </Text>
          {item.description ? (
            <Text className="text-slate-500 text-sm mt-1" numberOfLines={2}>
              {item.description}
            </Text>
          ) : null}
        </View>
        
        {/* Checkbox circle */}
        <View className={`w-6 h-6 rounded-full border items-center justify-center ${isSelected ? 'bg-[#126A56] border-[#126A56]' : 'border-slate-300'}`}>
          {isSelected && (
            <Text className="text-white text-xs font-bold">✓</Text>
          )}
        </View>
      </TouchableOpacity>
    );
  };

  return (
    <View className="flex-1 bg-[#FAFAF7]">
      <View className="pt-12 px-6 pb-4 bg-white shadow-sm z-10 border-b border-slate-100">
        <Text className="text-3xl font-bold text-slate-800 mb-2">Select Tasks</Text>
        <Text className="text-slate-500 text-base mb-4">Choose the services you want to provide.</Text>
        
        <View className="relative">
          <TextInput
            className="bg-slate-50 border border-slate-200 rounded-xl px-4 py-3 text-slate-800"
            placeholder="Search tasks..."
            placeholderTextColor="#94a3b8"
            value={searchQuery}
            onChangeText={(text) => {
              searchSeq.current += 1; // Invalidate any in-flight searches immediately
              lastSearchedQuery.current = null; // Invalidate already-searched marker
              setSearchQuery(text);
            }}
            editable={!submitting}
          />
          {searching && (
            <ActivityIndicator className="absolute right-4 top-3.5" size="small" color="#94a3b8" />
          )}
        </View>
      </View>

      {error ? (
        <View className="bg-red-50 p-4 mx-6 mt-4 rounded-xl border border-red-100">
          <Text className="text-red-700">{error}</Text>
        </View>
      ) : null}

      {searchError ? (
        <View className="bg-red-50 p-4 mx-6 mt-4 rounded-xl border border-red-100 flex-row justify-between items-center">
          <Text className="text-red-700 flex-1 mr-4">{searchError}</Text>
          <TouchableOpacity 
            className="bg-red-100 py-2 px-4 rounded-lg"
            onPress={() => handleSearch(searchQuery)}
          >
            <Text className="text-red-800 font-medium">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {listData.length === 0 && !searching ? (
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-slate-500 text-base text-center">No tasks found matching your search.</Text>
        </View>
      ) : (
        <FlatList
          data={listData}
          keyExtractor={(item) => item.id}
          renderItem={renderItem}
          contentContainerStyle={{ paddingBottom: 100 }}
          showsVerticalScrollIndicator={false}
        />
      )}

      {/* Floating Action Bar */}
      <View className={`absolute bottom-0 left-0 right-0 p-6 bg-white border-t border-slate-200 ${Platform.OS === 'ios' ? 'pb-8' : ''}`}>
        <TouchableOpacity
          className={`py-4 rounded-xl flex-row justify-center items-center ${submitting ? 'bg-[#126A56]/70' : 'bg-[#126A56]'}`}
          onPress={handleConfirm}
          disabled={submitting}
        >
          {submitting ? (
            <ActivityIndicator color="white" />
          ) : (
            <Text className="text-white text-base font-semibold">
              Confirm ({selectedTaskIds.size})
            </Text>
          )}
        </TouchableOpacity>
      </View>
    </View>
  );
}
