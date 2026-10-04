import React, { useState, useEffect, useCallback } from 'react';
import {
  View,
  Text,
  TouchableOpacity,
  ActivityIndicator,
  FlatList,
  Alert,
} from 'react-native';
import { useFocusEffect } from '@react-navigation/native';
import { tasksApi, authApi, ApiError } from '../api/client';
import { useSessionStore } from '../store/session';

export default function HomeScreen({ navigation }) {
  const { logOut, user } = useSessionStore();

  const [loading, setLoading] = useState(true);
  const [error, setError] = useState('');
  
  // Array of { categoryName, tasks: [...] }
  const [groupedTasks, setGroupedTasks] = useState([]);

  const loadData = useCallback(async () => {
    setLoading(true);
    setError('');
    try {
      const [catalogRes, myTasksRes] = await Promise.all([
        tasksApi.getTasks(), // Returns { categories: [...] }
        tasksApi.getMyTasks() // Returns { tasks: [...] }
      ]);
      
      const allCategories = catalogRes?.categories || [];
      const myTasks = myTasksRes?.tasks || [];
      
      // Map category IDs to names
      const categoryMap = {};
      allCategories.forEach(cat => {
        categoryMap[cat.id] = cat.name;
      });
      
      // Group myTasks by category
      const groups = {};
      myTasks.forEach(task => {
        const catName = categoryMap[task.categoryId] || 'Other Tasks';
        if (!groups[catName]) {
          groups[catName] = [];
        }
        groups[catName].push(task);
      });
      
      const formattedData = Object.keys(groups).map(name => ({
        categoryName: name,
        tasks: groups[name],
      }));
      
      // Sort categories alphabetically
      formattedData.sort((a, b) => a.categoryName.localeCompare(b.categoryName));
      
      setGroupedTasks(formattedData);
    } catch (err) {
      if (err instanceof ApiError) {
        setError(err.message);
      } else {
        setError('Failed to load your tasks. Please check your connection.');
      }
    } finally {
      setLoading(false);
    }
  }, []);

  useFocusEffect(
    useCallback(() => {
      loadData();
    }, [loadData])
  );

  const handleLogout = async () => {
    try {
      await authApi.logout();
    } catch (err) {
      // Even if network fails, we proceed with clearing local session
      console.warn('Logout network request failed:', err);
    } finally {
      // Clear SecureStore and Zustand state
      await logOut();
    }
  };

  const renderTask = ({ item }) => (
    <View className="bg-white border border-slate-200 rounded-xl p-4 mb-3 mx-6 shadow-sm">
      <Text className="text-base font-semibold text-slate-800">{item.name}</Text>
      {item.description ? (
        <Text className="text-slate-500 text-sm mt-1">{item.description}</Text>
      ) : null}
    </View>
  );

  const renderGroup = ({ item }) => (
    <View className="mb-4">
      <Text className="text-lg font-bold text-slate-800 mx-6 mt-4 mb-3">{item.categoryName}</Text>
      {item.tasks.map(task => (
        <React.Fragment key={task.id}>
          {renderTask({ item: task })}
        </React.Fragment>
      ))}
    </View>
  );

  if (loading && groupedTasks.length === 0) {
    return (
      <View className="flex-1 justify-center items-center bg-[#FAFAF7]">
        <ActivityIndicator size="large" color="#126A56" />
      </View>
    );
  }

  return (
    <View className="flex-1 bg-[#FAFAF7]">
      <View className="pt-12 px-6 pb-4 bg-white shadow-sm z-10 border-b border-slate-100 flex-row justify-between items-end">
        <View>
          <Text className="text-slate-500 text-sm uppercase tracking-wider mb-1">Welcome back</Text>
          <Text className="text-2xl font-bold text-slate-800" numberOfLines={1}>{user?.email?.split('@')[0]}</Text>
        </View>
        <TouchableOpacity onPress={handleLogout} className="bg-red-50 px-3 py-2 rounded-lg border border-red-100">
          <Text className="text-red-700 font-medium">Log out</Text>
        </TouchableOpacity>
      </View>

      {error ? (
        <View className="bg-red-50 p-4 mx-6 mt-6 rounded-xl border border-red-100 items-center">
          <Text className="text-red-700 mb-3 text-center">{error}</Text>
          <TouchableOpacity 
            className="bg-red-100 py-2 px-4 rounded-lg"
            onPress={loadData}
          >
            <Text className="text-red-800 font-medium">Retry</Text>
          </TouchableOpacity>
        </View>
      ) : null}

      {!error && groupedTasks.length === 0 ? (
        <View className="flex-1 justify-center items-center px-6">
          <Text className="text-slate-500 text-base text-center mb-6">
            You haven't selected any tasks yet.
          </Text>
          <TouchableOpacity 
            className="bg-[#126A56] py-3 px-6 rounded-xl shadow-sm"
            onPress={() => navigation.navigate('TaskSelection')}
          >
            <Text className="text-white font-semibold">Select Tasks</Text>
          </TouchableOpacity>
        </View>
      ) : (
        <FlatList
          data={groupedTasks}
          keyExtractor={(item) => item.categoryName}
          renderItem={renderGroup}
          contentContainerStyle={{ paddingBottom: 100, paddingTop: 10 }}
          showsVerticalScrollIndicator={false}
          refreshing={loading}
          onRefresh={loadData}
          ListHeaderComponent={
            groupedTasks.length > 0 && !error ? (
              <View className="px-6 mt-4 mb-2 flex-row justify-between items-center">
                <Text className="text-slate-500">Your Selected Tasks</Text>
                <TouchableOpacity onPress={() => navigation.navigate('TaskSelection')}>
                  <Text className="text-[#126A56] font-medium">Edit</Text>
                </TouchableOpacity>
              </View>
            ) : null
          }
        />
      )}
    </View>
  );
}
